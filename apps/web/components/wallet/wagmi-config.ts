import { createConfig, http } from "wagmi";
import type { CreateConnectorFn } from "wagmi";
import { hederaTestnet } from "wagmi/chains";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

import { RPC_URL, SITE_URL, WALLETCONNECT_PROJECT_ID } from "@/lib/env";

const APP_NAME = "RentAnLLM";
const APP_DESCRIPTION = "Open models, paid per call in USDC on Hedera.";

/**
 * WalletConnect is optional: without NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID we
 * only register browser (injected) wallets and Coinbase Wallet, so the app
 * builds and runs with zero configuration.
 */
export const hasWalletConnect = WALLETCONNECT_PROJECT_ID.length > 0;

/** The one chain the app runs on (sign-in and smart-wallet checks): Hedera testnet. */
export const appChain = hederaTestnet;

const buildConnectors = (): CreateConnectorFn[] => {
  const connectors: CreateConnectorFn[] = [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: APP_NAME }),
  ];
  if (hasWalletConnect) {
    connectors.push(
      walletConnect({
        metadata: {
          description: APP_DESCRIPTION,
          icons: [],
          name: APP_NAME,
          url: SITE_URL,
        },
        projectId: WALLETCONNECT_PROJECT_ID,
        showQrModal: false,
      })
    );
  }
  return connectors;
};

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: buildConnectors(),
  ssr: true,
  transports: { [hederaTestnet.id]: http(RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
