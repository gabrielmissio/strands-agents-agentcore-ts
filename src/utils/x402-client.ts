import axios from "axios";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export async function createX402Client(baseURL: string) {
    const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}`;

    if (!evmPrivateKey) {
        console.warn("EVM_PRIVATE_KEY not provided. The x402 client will be created without EVM capabilities, and paid endpoints will not work.");
        throw new Error("EVM_PRIVATE_KEY must be provided");
    }

    const client = new x402Client();

    if (evmPrivateKey) {
        const evmSigner = privateKeyToAccount(evmPrivateKey);
        client.register("eip155:*", new ExactEvmScheme(evmSigner));
    }

    return wrapAxiosWithPayment(axios.create({ baseURL }), client);
}
