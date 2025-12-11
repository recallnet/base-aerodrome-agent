/**
 * EigenAI Configuration
 *
 * Configuration for EigenAI's dTERMinal API integration with cryptographic signature verification.
 * This enables agents to prove they're using verifiable AI inference through ECDSA signatures.
 *
 * @see {@link https://determinal-api.eigenarcade.com} dTERMinal API Documentation
 */

/**
 * EigenAI and Recall API configuration
 *
 * EigenAI provides verifiable AI inference through cryptographic signatures.
 * All responses include ECDSA signatures that can be verified against known signer addresses.
 *
 * **Important**: dTERMinal API always uses mainnet signing (Chain ID 1) regardless of environment.
 */
export const EIGENAI_CONFIG = {
  /**
   * Enable EigenAI as the inference provider
   *
   * When `true`, the agent will use dTERMinal API instead of Anthropic.
   * When `false`, the agent will use the default Anthropic Claude model.
   *
   * @default false
   */
  enabled: process.env.EIGENAI_ENABLED === 'true',

  /**
   * dTERMinal API base URL
   *
   * @default 'https://determinal-api.eigenarcade.com'
   */
  apiUrl: process.env.EIGENAI_API_URL || 'https://determinal-api.eigenarcade.com',

  /**
   * Model ID to use for inference
   *
   * Available models:
   * - `qwen3-32b-128k-bf16` - Qwen3 32B parameter model (default, supports text responses)
   * - `gpt-oss-120b-f16` - 120B parameter model (tool-calling only, no text output)
   *
   * @default 'qwen3-32b-128k-bf16'
   */
   modelId: process.env.EIGENAI_MODEL_ID || 'qwen3-32b-128k-bf16',

  /**
   * Private key for grant wallet (used for authentication)
   *
   * **Important**: This should be a SEPARATE wallet from your trading wallet.
   * The grant wallet is used only for authenticating with dTERMinal API.
   * It needs to have an active grant (allocation of inference tokens).
   *
   * Format: 0x-prefixed hex string
   *
   * @required when `enabled` is `true`
   */
  grantWalletPrivateKey: process.env.EIGENAI_GRANT_PRIVATE_KEY || '',

  // ============================================================================
  // Signature Verification Configuration
  // ============================================================================

  /**
   * Chain ID used for signature verification
   *
   * **Important**: dTERMinal API ALWAYS uses mainnet (Chain ID 1) for signing,
   * regardless of whether your application is in development, staging, or production.
   *
   * @constant '1'
   */
  chainId: '1' as const,

  /**
   * Expected signer address for dTERMinal API (mainnet)
   *
   * All signatures from dTERMinal API should be signed by this address.
   * This is EigenAI's official signer for the mainnet network.
   *
   * @constant '0x7053bfb0433a16a2405de785d547b1b32cee0cf3'
   */
  expectedSigner: '0x7053bfb0433a16a2405de785d547b1b32cee0cf3' as const,

  /**
   * Enable local signature verification
   *
   * When `true`, all signatures received from dTERMinal API will be verified
   * locally using ECDSA recovery before being submitted to Recall API.
   *
   * @default true
   * @recommended Keep enabled for security
   */
  localVerificationEnabled: true,

  // ============================================================================
  // Recall API Configuration (Optional)
  // ============================================================================

  /**
   * Enable Recall API integration for signature submission
   *
   * When `true`, verified signatures will be submitted to Recall API for
   * competition compliance tracking. When `false`, signatures will only be
   * verified locally and stored in the database.
   *
   * @default false
   */
  recallEnabled: process.env.RECALL_ENABLED === 'true',

  /**
   * Recall API base URL
   *
   * @required when `recallEnabled` is `true`
   */
  recallApiUrl: process.env.RECALL_API_URL || '',

  /**
   * Recall API key for authentication
   *
   * Used for wallet verification and signature submission endpoints.
   *
   * @required for wallet verification (recall-verify command)
   */
  recallApiKey: process.env.RECALL_API_KEY || '',

  /**
   * Recall Agent ID
   *
   * Your agent's unique identifier in the Recall platform.
   * Used when submitting signatures to Recall API.
   *
   * @required when `recallEnabled` is `true`
   */
  recallAgentId: process.env.RECALL_AGENT_ID || '',

  /**
   * Recall Competition ID
   *
   * The competition you're participating in that requires EigenAI verification.
   * Multiple competition IDs can be configured if needed (comma-separated).
   *
   * @required when `recallEnabled` is `true`
   */
  recallCompetitionId: process.env.RECALL_COMPETITION_ID || '',

  // ============================================================================
  // Submission Configuration
  // ============================================================================

  /**
   * Maximum number of signatures to batch in a single submission to Recall API
   *
   * @default 10
   */
  submissionBatchSize: Number.parseInt(process.env.RECALL_SUBMISSION_BATCH_SIZE || '10', 10),

  /**
   * Interval in milliseconds between automatic batch submissions to Recall API
   *
   * @default 300000 (5 minutes)
   */
  submissionIntervalMs: Number.parseInt(
    process.env.RECALL_SUBMISSION_INTERVAL_MS || '300000',
    10
  ),

  /**
   * Maximum number of retry attempts for failed Recall API submissions
   *
   * @default 3
   */
  maxRetries: Number.parseInt(process.env.RECALL_MAX_RETRIES || '3', 10),
} as const

/**
 * Validate EigenAI configuration
 *
 * Checks that required environment variables are set when EigenAI is enabled.
 * Throws descriptive errors if configuration is invalid.
 *
 * @throws {Error} If required configuration is missing
 */
export function validateEigenAIConfig(): void {
  if (!EIGENAI_CONFIG.enabled) {
    return // No validation needed if disabled
  }

  // Validate grant wallet private key
  if (!EIGENAI_CONFIG.grantWalletPrivateKey) {
    throw new Error(
      'EIGENAI_GRANT_PRIVATE_KEY is required when EIGENAI_ENABLED=true.\n' +
        'This should be a separate wallet from your trading wallet, used only for API authentication.\n' +
        'The wallet needs an active grant (allocation of inference tokens) from EigenAI.'
    )
  }

  // Validate private key format
  if (!/^0x[0-9a-fA-F]{64}$/.test(EIGENAI_CONFIG.grantWalletPrivateKey)) {
    throw new Error(
      'EIGENAI_GRANT_PRIVATE_KEY must be a 0x-prefixed 64-character hex string.\n' +
        'Example format: 0x1234567890abcdef...'
    )
  }

  // Validate Recall configuration if enabled
  if (EIGENAI_CONFIG.recallEnabled) {
    if (!EIGENAI_CONFIG.recallApiUrl) {
      throw new Error('RECALL_API_URL is required when RECALL_ENABLED=true')
    }

    if (!EIGENAI_CONFIG.recallAgentId) {
      throw new Error('RECALL_AGENT_ID is required when RECALL_ENABLED=true')
    }

    if (!EIGENAI_CONFIG.recallCompetitionId) {
      throw new Error('RECALL_COMPETITION_ID is required when RECALL_ENABLED=true')
    }
  }
}

/**
 * Validate Recall wallet verification configuration
 *
 * Checks that required environment variables are set for wallet verification.
 * This is separate from validateEigenAIConfig() because wallet verification
 * can be used independently of EigenAI inference.
 *
 * @throws {Error} If required configuration is missing
 */
export function validateRecallVerificationConfig(): void {
  if (!EIGENAI_CONFIG.recallApiKey) {
    throw new Error('RECALL_API_KEY is required for wallet verification')
  }

  if (!EIGENAI_CONFIG.recallApiUrl) {
    throw new Error('RECALL_API_URL is required for wallet verification')
  }
}

/**
 * Log EigenAI configuration status (safe for logging - no secrets)
 *
 * Prints current configuration without exposing sensitive values.
 */
export function logEigenAIConfigStatus(): void {
  if (!EIGENAI_CONFIG.enabled) {
    console.log('🤖 LLM Provider: Anthropic Claude (default)')
    return
  }

  console.log('🤖 LLM Provider: EigenAI dTERMinal')
  console.log(`   API URL: ${EIGENAI_CONFIG.apiUrl}`)
  console.log(`   Model: ${EIGENAI_CONFIG.modelId}`)
  console.log(`   Grant Wallet: ${EIGENAI_CONFIG.grantWalletPrivateKey ? 'Configured ✓' : 'Missing ✗'}`)
  console.log(`   Chain ID: ${EIGENAI_CONFIG.chainId} (mainnet)`)
  console.log(`   Expected Signer: ${EIGENAI_CONFIG.expectedSigner}`)
  console.log(`   Local Verification: ${EIGENAI_CONFIG.localVerificationEnabled ? 'Enabled ✓' : 'Disabled'}`)

  if (EIGENAI_CONFIG.recallEnabled) {
    console.log('📡 Recall API: Enabled')
    console.log(`   API URL: ${EIGENAI_CONFIG.recallApiUrl}`)
    console.log(`   Agent ID: ${EIGENAI_CONFIG.recallAgentId}`)
    console.log(`   Competition ID: ${EIGENAI_CONFIG.recallCompetitionId}`)
    console.log(`   Batch Size: ${EIGENAI_CONFIG.submissionBatchSize}`)
    console.log(`   Submission Interval: ${EIGENAI_CONFIG.submissionIntervalMs / 1000}s`)
  } else {
    console.log('📡 Recall API: Disabled (local verification only)')
  }
}
