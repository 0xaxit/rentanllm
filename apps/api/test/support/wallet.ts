import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hederaTestnet } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

export const SIWE_DOMAIN = "localhost:3000";

/** A throwaway wallet (fresh random key per call; nothing real). */
export const makeWallet = () => {
  const account = privateKeyToAccount(generatePrivateKey());
  return {
    address: account.address,
    signIn: async (
      nonce: string,
      overrides: {
        readonly domain?: string;
        readonly expirationTime?: Date;
      } = {}
    ) => {
      const message = createSiweMessage({
        address: account.address,
        chainId: hederaTestnet.id,
        domain: overrides.domain ?? SIWE_DOMAIN,
        nonce,
        uri: `http://${SIWE_DOMAIN}`,
        version: "1",
        ...(overrides.expirationTime === undefined
          ? {}
          : { expirationTime: overrides.expirationTime }),
      });
      const signature = await account.signMessage({ message });
      return { message, signature };
    },
  };
};
