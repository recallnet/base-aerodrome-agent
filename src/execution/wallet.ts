/**
 * Wallet Management for Aerodrome Trading
 * Uses Alchemy SDK for reliable RPC access with proper typing
 * Handles wallet initialization, balance checks, and transaction signing
 */
import { Alchemy, Network, type TokenBalancesResponseErc20 } from 'alchemy-sdk'
import { ethers } from 'ethers'

import { API_CONFIG, BASE_CHAIN, ERC20_ABI } from '../config/index.js'
import {
  TOKEN_ADDRESSES,
  TOKEN_METADATA,
  type TokenSymbol,
  resolveToken,
} from '../config/tokens.js'

/** Singleton Alchemy instance */
let alchemyInstance: Alchemy | null = null

/** Singleton ethers provider (for contract interactions) */
let providerInstance: ethers.JsonRpcProvider | null = null

/** Singleton wallet instance */
let walletInstance: ethers.Wallet | null = null

/**
 * Extract Alchemy API key from RPC URL or env var
 */
function extractAlchemyApiKey(): string | undefined {
  const rpcUrl = process.env.BASE_RPC_URL
  if (rpcUrl?.includes('alchemy.com')) {
    // Extract API key from URL like: https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY
    const match = rpcUrl.match(/\/v2\/([^/]+)$/)
    return match?.[1]
  }
  return process.env.ALCHEMY_API_KEY
}

/**
 * Get the Alchemy SDK instance for Base chain
 * @returns Alchemy instance
 */
export function getAlchemy(): Alchemy {
  if (!alchemyInstance) {
    const apiKey = extractAlchemyApiKey()
    if (!apiKey) {
      throw new Error(
        'Alchemy API key required. Set BASE_RPC_URL with Alchemy URL or ALCHEMY_API_KEY env var.'
      )
    }
    alchemyInstance = new Alchemy({
      apiKey,
      network: Network.BASE_MAINNET,
      maxRetries: 3,
    })
  }
  return alchemyInstance
}

/**
 * Get the JSON-RPC provider for Base chain (for contract calls)
 * Uses Alchemy if ALCHEMY_API_KEY is set, otherwise falls back to BASE_RPC_URL or public RPC
 * @returns Provider instance
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!providerInstance) {
    // Priority: BASE_RPC_URL > Alchemy from API key > public fallback
    let rpcUrl = process.env.BASE_RPC_URL
    if (!rpcUrl) {
      const alchemyKey = process.env.ALCHEMY_API_KEY
      if (alchemyKey) {
        rpcUrl = `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`
      } else {
        rpcUrl = API_CONFIG.defaultRpcUrl
      }
    }
    // Use staticNetwork to prevent ethers from re-querying network on each call
    providerInstance = new ethers.JsonRpcProvider(
      rpcUrl,
      {
        chainId: BASE_CHAIN.chainId,
        name: BASE_CHAIN.name,
      },
      {
        staticNetwork: true,
      }
    )
  }
  return providerInstance
}

/**
 * Initialize and get the trading wallet
 * @throws Error if AGENT_PRIVATE_KEY is not set
 * @returns Wallet instance connected to provider
 */
export function getWallet(): ethers.Wallet {
  if (!walletInstance) {
    const privateKey = process.env.AGENT_PRIVATE_KEY
    if (!privateKey) {
      throw new Error('AGENT_PRIVATE_KEY environment variable is required for trading operations')
    }
    walletInstance = new ethers.Wallet(privateKey, getProvider())
  }
  return walletInstance
}

/**
 * Check if wallet is initialized (private key is available)
 * @returns True if wallet can be initialized
 */
export function isWalletConfigured(): boolean {
  return !!process.env.AGENT_PRIVATE_KEY
}

/**
 * Get the wallet address
 * @returns Wallet address or null if not configured
 */
export function getWalletAddress(): string | null {
  try {
    return getWallet().address
  } catch {
    return null
  }
}

/**
 * Balance information for a token
 */
export interface TokenBalance {
  symbol: string
  address: string
  balance: bigint
  balanceFormatted: string
  decimals: number
}

/**
 * Get native ETH balance of the wallet using Alchemy SDK
 * @returns Balance in wei and formatted
 */
export async function getEthBalance(): Promise<TokenBalance> {
  const wallet = getWallet()
  const alchemy = getAlchemy()

  const balanceHex = await alchemy.core.getBalance(wallet.address, 'latest')
  const balance = BigInt(balanceHex.toString())

  return {
    symbol: 'ETH',
    address: TOKEN_ADDRESSES.WETH, // Use WETH address for consistency
    balance,
    balanceFormatted: ethers.formatEther(balance),
    decimals: 18,
  }
}

/**
 * Get ERC20 token balance using Alchemy SDK
 * @param tokenAddressOrSymbol - Token address or symbol
 * @returns Token balance information
 */
export async function getTokenBalance(tokenAddressOrSymbol: string): Promise<TokenBalance> {
  const metadata = resolveToken(tokenAddressOrSymbol)
  if (!metadata) {
    throw new Error(`Unknown token: ${tokenAddressOrSymbol}`)
  }

  const wallet = getWallet()
  const alchemy = getAlchemy()

  // Use Alchemy's getTokenBalances for a single token
  const response: TokenBalancesResponseErc20 = await alchemy.core.getTokenBalances(wallet.address, [
    metadata.address,
  ])

  const tokenData = response.tokenBalances[0]
  if (!tokenData || tokenData.tokenBalance === null) {
    return {
      symbol: metadata.symbol,
      address: metadata.address,
      balance: 0n,
      balanceFormatted: '0',
      decimals: metadata.decimals,
    }
  }

  const balance = BigInt(tokenData.tokenBalance)

  return {
    symbol: metadata.symbol,
    address: metadata.address,
    balance,
    balanceFormatted: ethers.formatUnits(balance, metadata.decimals),
    decimals: metadata.decimals,
  }
}

/**
 * Get multiple token balances in a single batch call using Alchemy SDK
 * Much more efficient than individual calls
 * @param tokens - Array of token symbols or addresses
 * @returns Array of token balances
 */
export async function getBatchTokenBalances(tokens: TokenSymbol[]): Promise<TokenBalance[]> {
  const wallet = getWallet()
  const alchemy = getAlchemy()

  // Resolve all tokens to addresses
  const tokenAddresses = tokens
    .map((t) => TOKEN_METADATA[t]?.address)
    .filter((addr): addr is string => addr !== undefined)

  if (tokenAddresses.length === 0) {
    return []
  }

  // Single batch call for all tokens
  const response: TokenBalancesResponseErc20 = await alchemy.core.getTokenBalances(
    wallet.address,
    tokenAddresses
  )

  const balances: TokenBalance[] = []

  // Filter out zero balances and map to our type
  // Using explicit inline types as per js-recall pattern
  for (const tokenData of response.tokenBalances) {
    // Find metadata by address
    const metadata = Object.values(TOKEN_METADATA).find(
      (m) => m.address.toLowerCase() === tokenData.contractAddress.toLowerCase()
    )

    if (!metadata) continue

    // Convert hex balance to bigint (handling null case)
    const balance = tokenData.tokenBalance ? BigInt(tokenData.tokenBalance) : 0n

    balances.push({
      symbol: metadata.symbol,
      address: metadata.address,
      balance,
      balanceFormatted: ethers.formatUnits(balance, metadata.decimals),
      decimals: metadata.decimals,
    })
  }

  return balances
}

/**
 * Get all balances for configured tokens using batch call
 * @returns Array of token balances
 */
export async function getAllBalances(): Promise<TokenBalance[]> {
  const balances: TokenBalance[] = []

  // Get ETH balance
  balances.push(await getEthBalance())

  // Get all token balances in a single batch call
  const tokenSymbols: TokenSymbol[] = ['WETH', 'USDC', 'AERO', 'cbETH']
  const tokenBalances = await getBatchTokenBalances(tokenSymbols)
  balances.push(...tokenBalances)

  return balances
}

/**
 * Check token allowance for a spender
 * @param tokenAddressOrSymbol - Token address or symbol
 * @param spenderAddress - Address of the spender contract
 * @returns Current allowance
 */
export async function getTokenAllowance(
  tokenAddressOrSymbol: string,
  spenderAddress: string
): Promise<bigint> {
  const metadata = resolveToken(tokenAddressOrSymbol)
  const tokenAddress = metadata?.address || tokenAddressOrSymbol

  const wallet = getWallet()
  const provider = getProvider()

  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  const allowanceFn = tokenContract.getFunction('allowance')
  const allowanceResult: bigint = (await allowanceFn(wallet.address, spenderAddress)) as bigint
  return allowanceResult
}

/**
 * Approve token spending for a contract
 * @param tokenAddressOrSymbol - Token address or symbol
 * @param spenderAddress - Address of the spender contract
 * @param amount - Amount to approve (use MaxUint256 for unlimited)
 * @returns Transaction receipt or null if already approved
 */
export async function approveToken(
  tokenAddressOrSymbol: string,
  spenderAddress: string,
  amount: bigint = ethers.MaxUint256
): Promise<ethers.TransactionReceipt | null> {
  const metadata = resolveToken(tokenAddressOrSymbol)
  const tokenAddress = metadata?.address || tokenAddressOrSymbol

  const wallet = getWallet()
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet)

  // Check current allowance
  const currentAllowance = await getTokenAllowance(tokenAddressOrSymbol, spenderAddress)

  if (currentAllowance >= amount) {
    console.log(`Token ${tokenAddressOrSymbol} already approved for ${spenderAddress}`)
    return null
  }

  console.log(`Approving ${tokenAddressOrSymbol} for ${spenderAddress}...`)
  const approveFn = tokenContract.getFunction('approve')
  const txResponse = (await approveFn(spenderAddress, amount)) as ethers.ContractTransactionResponse
  const receipt = await txResponse.wait()

  if (!receipt) {
    throw new Error('Transaction failed - no receipt returned')
  }

  console.log(`Approval confirmed: ${receipt.hash}`)
  return receipt
}

/**
 * Estimate gas for a transaction with buffer
 * @param contract - Contract instance
 * @param method - Method name
 * @param args - Method arguments
 * @param bufferPercent - Gas buffer percentage (default 20%)
 * @returns Estimated gas with buffer
 */
export async function estimateGasWithBuffer(
  contract: ethers.Contract,
  method: string,
  args: unknown[],
  bufferPercent: number = 20
): Promise<bigint> {
  const contractFn = contract.getFunction(method)
  const estimated = await contractFn.estimateGas(...args)
  return (estimated * BigInt(100 + bufferPercent)) / 100n
}

/**
 * Get current gas settings for Base chain (EIP-1559)
 * @returns Gas price settings
 */
export async function getGasSettings(): Promise<{
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}> {
  const provider = getProvider()
  const feeData = await provider.getFeeData()

  return {
    maxFeePerGas: feeData.maxFeePerGas || ethers.parseUnits('0.1', 'gwei'),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.parseUnits('0.001', 'gwei'),
  }
}

/**
 * Wait for transaction confirmation with timeout
 * @param txHash - Transaction hash to wait for
 * @param confirmations - Number of confirmations required
 * @param timeoutMs - Timeout in milliseconds
 * @returns Transaction receipt
 */
export async function waitForConfirmation(
  txHash: string,
  confirmations: number = 1,
  timeoutMs: number = 60000
): Promise<ethers.TransactionReceipt> {
  const provider = getProvider()
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const receipt = await provider.getTransactionReceipt(txHash)

    if (receipt) {
      const currentBlock = await provider.getBlockNumber()
      const txConfirmations = currentBlock - receipt.blockNumber + 1

      if (txConfirmations >= confirmations) {
        if (receipt.status === 0) {
          throw new Error(`Transaction reverted: ${txHash}`)
        }
        return receipt
      }
    }

    // Wait 2 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  throw new Error(`Transaction timeout: ${txHash}`)
}

/**
 * Reset singleton instances (useful for testing)
 */
export function resetWalletInstances(): void {
  alchemyInstance = null
  providerInstance = null
  walletInstance = null
}
