// ============================================
// AI Settings Routes
// ============================================
const express = require('express');
const { query } = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/ai-settings - Get user's AI settings
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            `SELECT provider, api_key_encrypted, model_id, config
       FROM ai_settings
       WHERE workspace_id = $1 AND user_id = $2
       ORDER BY provider`,
            [req.user.workspace_id, req.user.id]
        );

        const settings = {};
        for (const row of result.rows) {
            settings[row.provider] = {
                apiKey: row.api_key_encrypted || '',
                modelId: row.model_id || '',
                config: typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {}),
            };
        }

        res.json({ success: true, data: settings });
    } catch (err) {
        console.error('Get AI settings error:', err);
        res.status(500).json({ success: false, message: 'Failed to get AI settings' });
    }
});

/**
 * PUT /api/ai-settings - Upsert AI settings
 * Body: { provider: string, apiKey: string, modelId: string, config: object }
 */
router.put('/', async (req, res) => {
    try {
        const { provider, apiKey, modelId, config } = req.body;

        if (!provider) {
            return res.status(400).json({ success: false, message: 'Provider is required' });
        }

        await query(
            `INSERT INTO ai_settings (workspace_id, user_id, provider, api_key_encrypted, model_id, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, user_id, provider)
       DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted, model_id = EXCLUDED.model_id, config = EXCLUDED.config`,
            [
                req.user.workspace_id,
                req.user.id,
                provider,
                apiKey || '',
                modelId || '',
                JSON.stringify(config || {}),
            ]
        );

        res.json({ success: true, message: 'AI settings saved' });
    } catch (err) {
        console.error('Save AI settings error:', err);
        res.status(500).json({ success: false, message: 'Failed to save AI settings' });
    }
});

/**
 * PUT /api/ai-settings/bulk - Bulk upsert all providers
 * Body: { settings: [{ provider, apiKey, modelId, config }] }
 */
router.put('/bulk', async (req, res) => {
    try {
        const { settings } = req.body;

        if (!settings || !Array.isArray(settings)) {
            return res.status(400).json({ success: false, message: 'settings array is required' });
        }

        for (const s of settings) {
            await query(
                `INSERT INTO ai_settings (workspace_id, user_id, provider, api_key_encrypted, model_id, config)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, user_id, provider)
         DO UPDATE SET api_key_encrypted = EXCLUDED.api_key_encrypted, model_id = EXCLUDED.model_id, config = EXCLUDED.config`,
                [
                    req.user.workspace_id,
                    req.user.id,
                    s.provider,
                    s.apiKey || '',
                    s.modelId || '',
                    JSON.stringify(s.config || {}),
                ]
            );
        }

        res.json({ success: true, message: 'All AI settings saved' });
    } catch (err) {
        console.error('Bulk save AI settings error:', err);
        res.status(500).json({ success: false, message: 'Failed to save AI settings' });
    }
});

module.exports = router;
