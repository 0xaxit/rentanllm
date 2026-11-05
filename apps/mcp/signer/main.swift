// rentanllm-signer: keeps the MCP payer's private key in the login keychain and releases
// it only after the person at the Mac approves the payment with Touch ID (or their
// password when Touch ID is unavailable).
//
//   rentanllm-signer store <account>            key on stdin; replaces any stored key
//   rentanllm-signer approve <account> <reason> Touch ID, then prints the key on stdout
//   rentanllm-signer status <account>           prints "stored" or "missing"
//   rentanllm-signer delete <account>
//
// The keychain item is created by this binary, so macOS lets this binary read it silently
// and asks for the login password before any other program (an agent running `security`,
// say) can. The Touch ID prompt shows `reason`, which the MCP server builds from the
// payment it is about to sign: amount, recipient, network.
//
// Exit codes: 0 ok, 1 usage, 2 not approved, 3 no key stored, 4 keychain error.

import Foundation
import LocalAuthentication
import Security

let service = "xyz.rentanllm.mcp.payer"

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data("rentanllm-signer: \(message)\n".utf8))
    exit(code)
}

func baseQuery(_ account: String) -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
    ]
}

func store(_ account: String) {
    let input = FileHandle.standardInput.readDataToEndOfFile()
    let key = String(decoding: input, as: UTF8.self)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !key.isEmpty else { fail("no key on stdin", 1) }
    SecItemDelete(baseQuery(account) as CFDictionary)
    var item = baseQuery(account)
    item[kSecValueData as String] = Data(key.utf8)
    item[kSecAttrLabel as String] = "RentAnLLM MCP payer key (\(account))"
    let status = SecItemAdd(item as CFDictionary, nil)
    guard status == errSecSuccess else { fail("could not store the key (OSStatus \(status))", 4) }
    print("stored")
}

func read(_ account: String) -> String? {
    var query = baseQuery(account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
        fail("could not read the key (OSStatus \(status))", 4)
    }
    return String(decoding: data, as: UTF8.self)
}

/// Blocks until the person approves or refuses. Touch ID first; the login password
/// is the fallback on Macs without it.
func approve(_ reason: String) -> Bool {
    let context = LAContext()
    context.localizedCancelTitle = "Deny"
    var error: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
        fail("this Mac cannot ask for approval: \(error?.localizedDescription ?? "unknown")", 2)
    }
    let done = DispatchSemaphore(value: 0)
    var approved = false
    context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, _ in
        approved = ok
        done.signal()
    }
    done.wait()
    return approved
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    fail("usage: rentanllm-signer store|approve|status|delete <account> [reason]", 1)
}
let command = args[1]
let account = args[2]

switch command {
case "store":
    store(account)
case "status":
    print(read(account) == nil ? "missing" : "stored")
case "delete":
    SecItemDelete(baseQuery(account) as CFDictionary)
    print("deleted")
case "approve":
    guard args.count >= 4 else { fail("approve needs a reason", 1) }
    guard read(account) != nil else { fail("no key stored for \(account)", 3) }
    guard approve(args[3]) else { fail("not approved", 2) }
    guard let key = read(account) else { fail("no key stored for \(account)", 3) }
    print(key)
default:
    fail("unknown command \(command)", 1)
}
