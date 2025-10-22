import * as hl from '@nktkas/hyperliquid';
import { ethers } from 'ethers';

import {
  createPKPSiweMessage,
  generateAuthSig,
  LitActionResource,
} from '@lit-protocol/auth-helpers';
import { LitNodeClient } from '@lit-protocol/lit-node-client';
import { PKPEthersWallet } from '@lit-protocol/pkp-ethers';
import {
  createVincentAbility,
  supportedPoliciesForAbility,
} from '@lit-protocol/vincent-ability-sdk';

import {
  executeFailSchema,
  executeSuccessSchema,
  precheckFailSchema,
  precheckSuccessSchema,
  abilityParamsSchema,
} from './schemas';

export const vincentAbility = createVincentAbility({
  packageName: '@kazemochizuki/vincent-ability-hyperliquid-perps' as const,
  abilityParamsSchema: abilityParamsSchema,
  abilityDescription: 'Trade perps in hyperliquid',
  supportedPolicies: supportedPoliciesForAbility([]),

  precheckSuccessSchema,
  precheckFailSchema,

  executeSuccessSchema,
  executeFailSchema,

  precheck: async ({ abilityParams }, { fail, succeed, delegation }) => {
    const { coin, amount, leverage } = abilityParams;
    const { ethAddress: pkpAddress } = delegation.delegatorPkpInfo;

    const infoClient = new hl.InfoClient({
      transport: new hl.HttpTransport(),
    });

    // check abilityParams
    const meta = await infoClient.meta();
    const coinInfo = meta.universe.find((u) => u.name === coin);

    if (!coinInfo) {
      return fail({
        error: `Coin '${coin}' is not a valid asset on Hyperliquid.`,
      });
    }

    const szDecimals = coinInfo.szDecimals;
    const minSz = Math.pow(10, -szDecimals);
    if (parseFloat(amount) < minSz) {
      return fail({
        error: `Amount ${amount} is less than minimum size ${minSz} for coin ${coin}.`,
      });
    }

    const maxLeverage = coinInfo.maxLeverage;
    if (maxLeverage < parseInt(leverage)) {
      return fail({
        error: `Leverage ${leverage} is not allowed for coin ${coin}. Max leverage is ${maxLeverage}.`,
      });
    }

    // check balance
    const clearinghouseState = await infoClient.clearinghouseState({ user: pkpAddress });
    const withdrawableUSDC = parseFloat(clearinghouseState.withdrawable);

    const allMids = await infoClient.allMids();
    const midPrice = allMids[coin];

    if (midPrice !== undefined) {
      console.log(`Mid price of ${coin} is ${midPrice}`);
    } else {
      return fail({
        error: `MidPrice of Coin ${coin} is not supported.`,
      });
    }

    const expectedUSDC =
      ((parseFloat(midPrice) * parseFloat(amount)) / parseFloat(leverage)) * 1.01; // add 1% slippage buffer
    if (withdrawableUSDC < expectedUSDC) {
      return fail({
        error: `Insufficient withdrawable USDC balance ${withdrawableUSDC} to open position requiring approximately ${expectedUSDC} USDC.`,
      });
    }

    return succeed({ withdrawableUSDC: withdrawableUSDC });
  },

  execute: async ({ abilityParams }, { succeed, fail, delegation }) => {
    try {
      const { coin, side, amount, leverage, delegateePrivateKey } = abilityParams;
      const { publicKey: pkpPublicKey } = delegation.delegatorPkpInfo;

      // Create ExchangeClient by PKPWallet
      const delegateeWallet = new ethers.Wallet(delegateePrivateKey); // Vincent App .env

      const litNodeClient = new LitNodeClient({ litNetwork: 'datil' });
      await litNodeClient.connect();
      const sessionKeyUri = litNodeClient.getSessionKeyUri(pkpPublicKey);
      const preparedSiweMessage = await createPKPSiweMessage({
        nonce: Date.now().toString(),
        expiration: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        pkpPublicKey: pkpPublicKey,
        sessionKeyUri: sessionKeyUri,
      });
      const authSig = await generateAuthSig({
        signer: delegateeWallet,
        toSign: preparedSiweMessage,
      });
      const resourceAbilityRequests = [
        {
          resource: new LitActionResource('*'),
          ability: 'pkp-signing',
        },
      ];
      const authNeededCallback = async () => {
        return authSig;
      };
      const controllerSessionSigs = await litNodeClient.getSessionSigs({
        chain: 'ethereum',
        expiration: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        resourceAbilityRequests: resourceAbilityRequests as any,
        authNeededCallback,
      });
      const pkpWallet = new PKPEthersWallet({
        litNodeClient: litNodeClient,
        pkpPubKey: pkpPublicKey,
        controllerSessionSigs: controllerSessionSigs,
      });

      const exchClient = new hl.ExchangeClient({
        transport: new hl.HttpTransport(),
        wallet: pkpWallet,
      });

      // Set Leverage
      const resultLeverage = await exchClient.updateLeverage({
        leverage: leverage,
        asset: coin,
        isCross: false,
      });
      console.log(`Leverage set result: ${JSON.stringify(resultLeverage)}`);

      // Place Order
      const infoClient = new hl.InfoClient({
        transport: new hl.HttpTransport(),
      });
      const meta = await infoClient.meta();
      const coinIndex = meta.universe.findIndex((u) => u.name === coin);

      const coinInfo = meta.universe.find((u) => u.name === coin);
      if (!coinInfo) {
        return fail({
          error: `Coin '${coin}' is not a valid asset on Hyperliquid.`,
        });
      }

      const szDecimals: number = coinInfo.szDecimals;
      const pxDecimals: number = 6 - szDecimals;

      const allMids = await infoClient.allMids();
      const midPrice = Number(allMids[coin]);
      if (Number.isNaN(midPrice)) {
        throw new Error(`midPrice for ${coin} is not a number`);
      }

      let isBuy: boolean;
      let price: number;

      if (side === 'buy') {
        isBuy = true;
        price = midPrice + Math.pow(10, -pxDecimals);
      } else {
        isBuy = false;
        price = midPrice - Math.pow(10, -pxDecimals);
      }

      const result = await exchClient.order({
        orders: [
          {
            a: coinIndex,
            b: isBuy,
            p: price.toString(),
            s: amount,
            r: false,
            t: {
              limit: {
                tif: 'Gtc',
              },
            },
          },
        ],
        grouping: 'na',
      });

      const resultString = JSON.stringify(result);

      return succeed({
        result: resultString,
      });
    } catch (error) {
      console.error(error);
      return fail({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    }
  },
});
