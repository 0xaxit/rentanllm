import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { clientAddress, isPrivateAddress } from "../src/region.ts";

describe("clientAddress", () => {
  it("takes the right-most public hop, so a forged left entry is ignored", () => {
    expect(
      clientAddress(
        "6.6.6.6, 49.36.10.20, 172.18.0.5",
        Option.some("172.18.0.4")
      )
    ).toBe("49.36.10.20");
  });

  it("falls back to the peer address", () => {
    expect(clientAddress(undefined, Option.some("::ffff:49.36.10.20"))).toBe(
      "49.36.10.20"
    );
    expect(clientAddress("", Option.none())).toBeNull();
  });
});

describe("isPrivateAddress", () => {
  it("recognises loopback, LAN, CGNAT and IPv6 local ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.11",
      "172.20.0.2",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("49.36.10.20")).toBe(false);
  });
});
