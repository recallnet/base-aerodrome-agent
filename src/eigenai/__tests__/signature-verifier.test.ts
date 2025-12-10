/**
 * Signature Verifier Tests
 *
 * Tests for ECDSA signature verification of EigenAI dTERMinal API responses.
 */
import { Wallet } from 'ethers'
import { beforeEach, describe, expect, it } from 'vitest'

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../types.js'
import {
  computeHash,
  createAuditHashes,
  reconstructSignedMessage,
  verifySignature,
} from '../signature-verifier.js'

describe('Signature Verifier', () => {
  let testWallet: Wallet
  let mockRequest: ChatCompletionRequest
  let mockResponse: ChatCompletionResponse

  beforeEach(() => {
    testWallet = Wallet.createRandom()

    mockRequest = {
      messages: [
        { role: 'system', content: 'You are a trading assistant.' },
        { role: 'user', content: 'What is the price of ETH?' },
      ],
      model: 'gpt-oss-120b-f16',
      grantMessage: 'test grant',
      grantSignature: '0x',
      walletAddress: testWallet.address,
    }

    mockResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-oss-120b-f16',
      system_fingerprint: 'fp_abc123',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'The current price of ETH is $3,500.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 15,
        total_tokens: 35,
      },
      signature: '', // Will be set in tests
    }
  })

  describe('reconstructSignedMessage', () => {
    it('should concatenate chainId, model, prompt, and output without separators', () => {
      const message = reconstructSignedMessage(mockRequest, mockResponse, '1')

      expect(message).toBe(
        '1gpt-oss-120b-f16You are a trading assistant.What is the price of ETH?The current price of ETH is $3,500.'
      )
    })

    it('should handle empty messages array', () => {
      const emptyRequest: ChatCompletionRequest = {
        ...mockRequest,
        messages: [],
      }

      const message = reconstructSignedMessage(emptyRequest, mockResponse, '1')

      expect(message).toBe('1gpt-oss-120b-f16The current price of ETH is $3,500.')
    })

    it('should handle multiple choices in response', () => {
      const multiChoiceResponse: ChatCompletionResponse = {
        ...mockResponse,
        choices: [
          { index: 0, message: { role: 'assistant', content: 'First ' }, finish_reason: 'stop' },
          { index: 1, message: { role: 'assistant', content: 'Second' }, finish_reason: 'stop' },
        ],
      }

      const message = reconstructSignedMessage(mockRequest, multiChoiceResponse, '1')

      expect(message).toContain('First Second')
    })

    it('should handle null/undefined content gracefully', () => {
      const nullContentRequest: ChatCompletionRequest = {
        ...mockRequest,
        messages: [
          { role: 'user', content: '' },
        ],
      }

      const message = reconstructSignedMessage(nullContentRequest, mockResponse, '1')

      expect(message).toBe('1gpt-oss-120b-f16The current price of ETH is $3,500.')
    })

    it('should use different chain IDs correctly', () => {
      const mainnet = reconstructSignedMessage(mockRequest, mockResponse, '1')
      const base = reconstructSignedMessage(mockRequest, mockResponse, '8453')

      expect(mainnet.startsWith('1')).toBe(true)
      expect(base.startsWith('8453')).toBe(true)
    })
  })

  describe('verifySignature', () => {
    it('should verify a valid signature', async () => {
      const reconstructedMessage = reconstructSignedMessage(mockRequest, mockResponse, '1')
      const signature = await testWallet.signMessage(reconstructedMessage)

      const validResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature,
      }

      const result = await verifySignature({
        request: mockRequest,
        response: validResponse,
        chainId: '1',
        expectedSigner: testWallet.address,
      })

      expect(result.isValid).toBe(true)
      expect(result.recoveredAddress.toLowerCase()).toBe(testWallet.address.toLowerCase())
      expect(result.error).toBeUndefined()
    })

    it('should reject signature from wrong signer', async () => {
      const otherWallet = Wallet.createRandom()
      const reconstructedMessage = reconstructSignedMessage(mockRequest, mockResponse, '1')
      const signature = await otherWallet.signMessage(reconstructedMessage)

      const validResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature,
      }

      const result = await verifySignature({
        request: mockRequest,
        response: validResponse,
        chainId: '1',
        expectedSigner: testWallet.address,
      })

      expect(result.isValid).toBe(false)
      expect(result.recoveredAddress.toLowerCase()).toBe(otherWallet.address.toLowerCase())
    })

    it('should handle signature without 0x prefix', async () => {
      const reconstructedMessage = reconstructSignedMessage(mockRequest, mockResponse, '1')
      const signature = await testWallet.signMessage(reconstructedMessage)
      const signatureWithoutPrefix = signature.slice(2)

      const validResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature: signatureWithoutPrefix,
      }

      const result = await verifySignature({
        request: mockRequest,
        response: validResponse,
        chainId: '1',
        expectedSigner: testWallet.address,
      })

      expect(result.isValid).toBe(true)
    })

    it('should return error for invalid signature format', async () => {
      const invalidResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature: 'not-a-valid-signature',
      }

      const result = await verifySignature({
        request: mockRequest,
        response: invalidResponse,
        chainId: '1',
        expectedSigner: testWallet.address,
      })

      expect(result.isValid).toBe(false)
      expect(result.recoveredAddress).toBe('ERROR')
      expect(result.error).toBeDefined()
    })

    it('should handle case-insensitive address comparison', async () => {
      const reconstructedMessage = reconstructSignedMessage(mockRequest, mockResponse, '1')
      const signature = await testWallet.signMessage(reconstructedMessage)

      const validResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature,
      }

      const result = await verifySignature({
        request: mockRequest,
        response: validResponse,
        chainId: '1',
        expectedSigner: testWallet.address.toUpperCase(),
      })

      expect(result.isValid).toBe(true)
    })
  })

  describe('computeHash', () => {
    it('should compute consistent keccak256 hash', () => {
      const hash1 = computeHash('test data')
      const hash2 = computeHash('test data')

      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^0x[a-f0-9]{64}$/)
    })

    it('should produce different hashes for different inputs', () => {
      const hash1 = computeHash('test data 1')
      const hash2 = computeHash('test data 2')

      expect(hash1).not.toBe(hash2)
    })

    it('should handle empty string', () => {
      const hash = computeHash('')

      expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
    })

    it('should handle unicode characters', () => {
      const hash = computeHash('Hello 世界 🚀')

      expect(hash).toMatch(/^0x[a-f0-9]{64}$/)
    })
  })

  describe('createAuditHashes', () => {
    it('should create hashes for request and response', () => {
      const hashes = createAuditHashes(mockRequest, mockResponse)

      expect(hashes.requestHash).toMatch(/^0x[a-f0-9]{64}$/)
      expect(hashes.responseHash).toMatch(/^0x[a-f0-9]{64}$/)
    })

    it('should produce consistent hashes for same request/response', () => {
      const hashes1 = createAuditHashes(mockRequest, mockResponse)
      const hashes2 = createAuditHashes(mockRequest, mockResponse)

      expect(hashes1.requestHash).toBe(hashes2.requestHash)
      expect(hashes1.responseHash).toBe(hashes2.responseHash)
    })

    it('should produce different request hashes for different prompts', () => {
      const request2: ChatCompletionRequest = {
        ...mockRequest,
        messages: [{ role: 'user', content: 'Different question' }],
      }

      const hashes1 = createAuditHashes(mockRequest, mockResponse)
      const hashes2 = createAuditHashes(request2, mockResponse)

      expect(hashes1.requestHash).not.toBe(hashes2.requestHash)
      expect(hashes1.responseHash).toBe(hashes2.responseHash)
    })

    it('should produce different response hashes for different outputs', () => {
      const response2: ChatCompletionResponse = {
        ...mockResponse,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Different answer' },
            finish_reason: 'stop',
          },
        ],
      }

      const hashes1 = createAuditHashes(mockRequest, mockResponse)
      const hashes2 = createAuditHashes(mockRequest, response2)

      expect(hashes1.requestHash).toBe(hashes2.requestHash)
      expect(hashes1.responseHash).not.toBe(hashes2.responseHash)
    })
  })

  describe('Edge Cases', () => {
    it('should handle very long messages', async () => {
      const longContent = 'A'.repeat(10000)
      const longRequest: ChatCompletionRequest = {
        ...mockRequest,
        messages: [{ role: 'user', content: longContent }],
      }

      const message = reconstructSignedMessage(longRequest, mockResponse, '1')
      const signature = await testWallet.signMessage(message)

      const validResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature,
      }

      const result = await verifySignature({
        request: longRequest,
        response: validResponse,
        chainId: '1',
        expectedSigner: testWallet.address,
      })

      expect(result.isValid).toBe(true)
    })

    it('should handle special characters in messages', async () => {
      const specialRequest: ChatCompletionRequest = {
        ...mockRequest,
        messages: [{ role: 'user', content: 'Test with <script>alert("xss")</script> & "quotes"' }],
      }

      const message = reconstructSignedMessage(specialRequest, mockResponse, '1')
      const signature = await testWallet.signMessage(message)

      const validResponse: ChatCompletionResponse = {
        ...mockResponse,
        signature,
      }

      const result = await verifySignature({
        request: specialRequest,
        response: validResponse,
        chainId: '1',
        expectedSigner: testWallet.address,
      })

      expect(result.isValid).toBe(true)
    })
  })
})
