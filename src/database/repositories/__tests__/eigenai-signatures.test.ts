/**
 * EigenAI Signatures Repository Tests
 *
 * Tests for storing and querying EigenAI signature records for verifiable inference.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../db.js'
import { eigenaiSignatures, tradingDiary } from '../../schema/trading/defs.js'
import { EigenAISignaturesRepository } from '../trading-diary.js'

describe('EigenAISignaturesRepository', () => {
  let repo: EigenAISignaturesRepository

  beforeEach(async () => {
    repo = new EigenAISignaturesRepository()
    await db.delete(eigenaiSignatures)
    await db.delete(tradingDiary)
  })

  describe('createSignature', () => {
    it('should create a new signature record', async () => {
      const signature = await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
        recoveredSigner: '0x7053bfb0433a16a2405de785d547b1b32cee0cf3',
        expectedSigner: '0x7053bfb0433a16a2405de785d547b1b32cee0cf3',
      })

      expect(signature.id).toBeDefined()
      expect(signature.iterationNumber).toBe(1)
      expect(signature.modelId).toBe('gpt-oss-120b-f16')
      expect(signature.localVerificationStatus).toBe('verified')
      expect(signature.submittedToRecall).toBe(false)
    })

    it('should allow pending verification status', async () => {
      const signature = await repo.createSignature({
        iterationNumber: 2,
        signature: '0x' + 'd'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'e'.repeat(64),
        responseHash: '0x' + 'f'.repeat(64),
        localVerificationStatus: 'pending',
      })

      expect(signature.localVerificationStatus).toBe('pending')
    })

    it('should store verification error for invalid signatures', async () => {
      const signature = await repo.createSignature({
        iterationNumber: 3,
        signature: '0x' + '1'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + '2'.repeat(64),
        responseHash: '0x' + '3'.repeat(64),
        localVerificationStatus: 'invalid',
        verificationError: 'Recovered signer does not match expected',
        recoveredSigner: '0x1234567890123456789012345678901234567890',
        expectedSigner: '0x7053bfb0433a16a2405de785d547b1b32cee0cf3',
      })

      expect(signature.localVerificationStatus).toBe('invalid')
      expect(signature.verificationError).toBe('Recovered signer does not match expected')
    })
  })

  describe('getByIteration', () => {
    it('should retrieve signature by iteration number', async () => {
      await repo.createSignature({
        iterationNumber: 42,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const result = await repo.getByIteration(42)

      expect(result).not.toBeNull()
      expect(result!.iterationNumber).toBe(42)
    })

    it('should return null for non-existent iteration', async () => {
      const result = await repo.getByIteration(999)

      expect(result).toBeNull()
    })
  })

  describe('getPendingRecallSubmission', () => {
    it('should return only verified signatures not submitted to Recall', async () => {
      await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + '1'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'a'.repeat(64),
        responseHash: '0x' + 'b'.repeat(64),
        localVerificationStatus: 'verified',
      })

      await repo.createSignature({
        iterationNumber: 2,
        signature: '0x' + '2'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'c'.repeat(64),
        responseHash: '0x' + 'd'.repeat(64),
        localVerificationStatus: 'pending',
      })

      await repo.createSignature({
        iterationNumber: 3,
        signature: '0x' + '3'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'e'.repeat(64),
        responseHash: '0x' + 'f'.repeat(64),
        localVerificationStatus: 'invalid',
      })

      const pending = await repo.getPendingRecallSubmission()

      expect(pending.length).toBe(1)
      expect(pending[0].iterationNumber).toBe(1)
    })

    it('should respect limit parameter', async () => {
      for (let i = 1; i <= 5; i++) {
        await repo.createSignature({
          iterationNumber: i,
          signature: '0x' + i.toString().repeat(130),
          modelId: 'gpt-oss-120b-f16',
          requestHash: '0x' + 'a'.repeat(64),
          responseHash: '0x' + 'b'.repeat(64),
          localVerificationStatus: 'verified',
        })
      }

      const pending = await repo.getPendingRecallSubmission(3)

      expect(pending.length).toBe(3)
    })

    it('should order by timestamp ascending', async () => {
      const sig1 = await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + '1'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'a'.repeat(64),
        responseHash: '0x' + 'b'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const sig2 = await repo.createSignature({
        iterationNumber: 2,
        signature: '0x' + '2'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'c'.repeat(64),
        responseHash: '0x' + 'd'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const pending = await repo.getPendingRecallSubmission()

      expect(pending[0].iterationNumber).toBe(1)
      expect(pending[1].iterationNumber).toBe(2)
    })
  })

  describe('markSubmittedToRecall', () => {
    it('should update submission status and ID', async () => {
      const sig = await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const updated = await repo.markSubmittedToRecall(sig.id, 'recall-submission-123')

      expect(updated.submittedToRecall).toBe(true)
      expect(updated.recallSubmissionId).toBe('recall-submission-123')
      expect(updated.recallSubmittedAt).not.toBeNull()
      expect(updated.recallVerificationStatus).toBe('pending')
    })

    it('should no longer appear in pending submissions', async () => {
      const sig = await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
      })

      await repo.markSubmittedToRecall(sig.id, 'recall-123')

      const pending = await repo.getPendingRecallSubmission()
      expect(pending.length).toBe(0)
    })
  })

  describe('updateRecallStatus', () => {
    it('should update to verified status', async () => {
      const sig = await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const updated = await repo.updateRecallStatus(sig.id, 'verified')

      expect(updated.recallVerificationStatus).toBe('verified')
      expect(updated.recallError).toBeNull()
    })

    it('should update to rejected status with error', async () => {
      const sig = await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const updated = await repo.updateRecallStatus(sig.id, 'rejected', 'Invalid signature format')

      expect(updated.recallVerificationStatus).toBe('rejected')
      expect(updated.recallError).toBe('Invalid signature format')
    })

    it('should update to error status', async () => {
      const sig = await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const updated = await repo.updateRecallStatus(sig.id, 'error', 'Network timeout')

      expect(updated.recallVerificationStatus).toBe('error')
      expect(updated.recallError).toBe('Network timeout')
    })
  })

  describe('getRecent', () => {
    it('should return signatures ordered by timestamp descending', async () => {
      await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + '1'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'a'.repeat(64),
        responseHash: '0x' + 'b'.repeat(64),
        localVerificationStatus: 'verified',
      })

      await repo.createSignature({
        iterationNumber: 2,
        signature: '0x' + '2'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'c'.repeat(64),
        responseHash: '0x' + 'd'.repeat(64),
        localVerificationStatus: 'verified',
      })

      const recent = await repo.getRecent()

      expect(recent.length).toBe(2)
      expect(recent[0].iterationNumber).toBe(2)
      expect(recent[1].iterationNumber).toBe(1)
    })

    it('should respect limit parameter', async () => {
      for (let i = 1; i <= 30; i++) {
        await repo.createSignature({
          iterationNumber: i,
          signature: '0x' + i.toString().padStart(130, '0'),
          modelId: 'gpt-oss-120b-f16',
          requestHash: '0x' + 'a'.repeat(64),
          responseHash: '0x' + 'b'.repeat(64),
          localVerificationStatus: 'verified',
        })
      }

      const recent = await repo.getRecent(5)

      expect(recent.length).toBe(5)
    })
  })

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await repo.createSignature({
        iterationNumber: 1,
        signature: '0x' + '1'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'a'.repeat(64),
        responseHash: '0x' + 'b'.repeat(64),
        localVerificationStatus: 'verified',
      })

      await repo.createSignature({
        iterationNumber: 2,
        signature: '0x' + '2'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'c'.repeat(64),
        responseHash: '0x' + 'd'.repeat(64),
        localVerificationStatus: 'verified',
      })

      await repo.createSignature({
        iterationNumber: 3,
        signature: '0x' + '3'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'e'.repeat(64),
        responseHash: '0x' + 'f'.repeat(64),
        localVerificationStatus: 'invalid',
      })

      const sig = await repo.createSignature({
        iterationNumber: 4,
        signature: '0x' + '4'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'g'.repeat(64),
        responseHash: '0x' + 'h'.repeat(64),
        localVerificationStatus: 'verified',
      })
      await repo.markSubmittedToRecall(sig.id, 'recall-123')

      const stats = await repo.getStats()

      expect(Number(stats.total)).toBe(4)
      expect(Number(stats.verified)).toBe(3)
      expect(Number(stats.invalid)).toBe(1)
      expect(Number(stats.submittedToRecall)).toBe(1)
    })

    it('should return zeros for empty table', async () => {
      const stats = await repo.getStats()

      expect(Number(stats.total)).toBe(0)
      expect(Number(stats.verified)).toBe(0)
      expect(Number(stats.invalid)).toBe(0)
      expect(Number(stats.submittedToRecall)).toBe(0)
    })
  })

  describe('Integration with tradingDiary', () => {
    it('should link signature to diary entry', async () => {
      const [diaryEntry] = await db
        .insert(tradingDiary)
        .values({
          iterationNumber: 1,
          tokenIn: 'WETH',
          tokenOut: 'AERO',
          action: 'BUY',
          reasoning: 'Test trade',
        })
        .returning()

      const signature = await repo.createSignature({
        iterationNumber: 1,
        diaryId: diaryEntry.id,
        signature: '0x' + 'a'.repeat(130),
        modelId: 'gpt-oss-120b-f16',
        requestHash: '0x' + 'b'.repeat(64),
        responseHash: '0x' + 'c'.repeat(64),
        localVerificationStatus: 'verified',
      })

      expect(signature.diaryId).toBe(diaryEntry.id)
    })
  })
})
