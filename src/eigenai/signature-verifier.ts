/**
 * EigenAI Signature Verification
 *
 * Verifies ECDSA signatures from dTERMinal API responses.
 * Uses message reconstruction: ChainID + ModelID + FullPrompt + FullOutput
 *
 * @module eigenai/signature-verifier
 */

import { ethers } from 'ethers'

import { EIGENAI_CONFIG } from '../config/eigenai.js'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  SignatureVerificationData,
  SignatureVerificationResult,
} from './types.js'

/**
 * Reconstruct the full prompt from messages array
 *
 * Concatenates all message contents with no separators.
 *
 * @param messages - Array of chat messages
 * @returns Concatenated prompt string
 */
function reconstructFullPrompt(
  messages: ChatCompletionRequest['messages']
): string {
  return messages.map((m) => m.content || '').join('')
}

/**
 * Reconstruct the full output from response choices
 *
 * Concatenates all choice message contents with no separators.
 *
 * @param choices - Array of response choices
 * @returns Concatenated output string
 */
function reconstructFullOutput(
  choices: ChatCompletionResponse['choices']
): string {
  return choices.map((c) => c.message.content || '').join('')
}

/**
 * Reconstruct the signed message from request and response
 *
 * Message format: ChainID + ModelID + FullPrompt + FullOutput
 * - No spaces, commas, or separators between components
 * - Example: "1gpt-oss-120b-f16Hello worldHello! How can I help?"
 *
 * @param request - Original chat completion request
 * @param response - Chat completion response
 * @param chainId - Network chain ID (default: "1" for mainnet)
 * @returns Reconstructed message string
 */
export function reconstructSignedMessage(
  request: ChatCompletionRequest,
  response: ChatCompletionResponse,
  chainId: string = EIGENAI_CONFIG.chainId
): string {
  const modelId = response.model
  const fullPrompt = reconstructFullPrompt(request.messages)
  const fullOutput = reconstructFullOutput(response.choices)

  // Concatenate with NO separators
  return `${chainId}${modelId}${fullPrompt}${fullOutput}`
}

/**
 * Verify an EigenAI signature
 *
 * Reconstructs the signed message and uses ECDSA recovery to verify
 * the signature was created by the expected signer address.
 *
 * @param data - Verification data containing request, response, and expected signer
 * @returns Verification result with recovered address and validity
 *
 * @example
 * ```typescript
 * const result = await verifySignature({
 *   request: chatRequest,
 *   response: chatResponse,
 *   chainId: '1',
 *   expectedSigner: '0x7053bfb0433a16a2405de785d547b1b32cee0cf3'
 * })
 *
 * if (result.isValid) {
 *   console.log('Signature verified!')
 * }
 * ```
 */
export async function verifySignature(
  data: SignatureVerificationData
): Promise<SignatureVerificationResult> {
  const { request, response, chainId, expectedSigner } = data

  try {
    // Reconstruct the message that was signed
    const reconstructedMessage = reconstructSignedMessage(
      request,
      response,
      chainId
    )

    // Get signature from response (ensure 0x prefix)
    const signature = response.signature.startsWith('0x')
      ? response.signature
      : `0x${response.signature}`

    // Recover signer address using ethers
    const recoveredAddress = ethers.verifyMessage(reconstructedMessage, signature)

    // Compare addresses (case-insensitive)
    const isValid =
      recoveredAddress.toLowerCase() === expectedSigner.toLowerCase()

    return {
      isValid,
      recoveredAddress,
      expectedSigner,
      reconstructedMessage,
    }
  } catch (error) {
    return {
      isValid: false,
      recoveredAddress: 'ERROR',
      expectedSigner,
      reconstructedMessage: '',
      error: error instanceof Error ? error.message : 'Unknown verification error',
    }
  }
}

/**
 * Verify an EigenAI signature using default configuration
 *
 * Uses EIGENAI_CONFIG for chain ID and expected signer.
 * This is the recommended function for most use cases.
 *
 * @param request - Original chat completion request
 * @param response - Chat completion response with signature
 * @returns Verification result
 *
 * @example
 * ```typescript
 * const result = await verifyEigenAISignature(request, response)
 *
 * if (result.isValid) {
 *   console.log('Verified! Signer:', result.recoveredAddress)
 * } else {
 *   console.error('Invalid signature:', result.error)
 * }
 * ```
 */
export async function verifyEigenAISignature(
  request: ChatCompletionRequest,
  response: ChatCompletionResponse
): Promise<SignatureVerificationResult> {
  return verifySignature({
    request,
    response,
    chainId: EIGENAI_CONFIG.chainId,
    expectedSigner: EIGENAI_CONFIG.expectedSigner,
  })
}

/**
 * Quick check if a response has a valid signature
 *
 * Returns true/false without full verification details.
 * Use for simple validation checks.
 *
 * @param request - Original chat completion request
 * @param response - Chat completion response with signature
 * @returns Whether signature is valid
 */
export async function isSignatureValid(
  request: ChatCompletionRequest,
  response: ChatCompletionResponse
): Promise<boolean> {
  const result = await verifyEigenAISignature(request, response)
  return result.isValid
}

/**
 * Compute SHA256 hash of a string
 *
 * Used for creating audit trail hashes of requests and responses.
 *
 * @param data - String to hash
 * @returns Hex-encoded SHA256 hash
 */
export function computeHash(data: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(data))
}

/**
 * Create hashes for request and response
 *
 * Used for storing audit trail without full request/response data.
 *
 * @param request - Chat completion request
 * @param response - Chat completion response
 * @returns Object with request and response hashes
 */
export function createAuditHashes(
  request: ChatCompletionRequest,
  response: ChatCompletionResponse
): { requestHash: string; responseHash: string } {
  // Hash the full reconstructed prompt for request
  const fullPrompt = reconstructFullPrompt(request.messages)
  const requestHash = computeHash(fullPrompt)

  // Hash the full output for response
  const fullOutput = reconstructFullOutput(response.choices)
  const responseHash = computeHash(fullOutput)

  return { requestHash, responseHash }
}
