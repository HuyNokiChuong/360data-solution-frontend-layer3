const { query } = require('../config/db');

const normalizeText = (value) => String(value || '').trim();
const normalizeToken = (value) => normalizeText(value).toLowerCase();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const cleanJson = (text) => {
    const raw = normalizeText(text);
    if (!raw) return '';
    const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenced) return normalizeText(fenced[1]);
    return raw;
};

const parseJsonObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(cleanJson(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_err) {
        return null;
    }
};

const sanitizeSchema = (schema) => {
    if (!Array.isArray(schema)) return [];
    return schema
        .map((column) => ({
            name: normalizeText(column?.name),
            type: normalizeText(column?.type),
        }))
        .filter((column) => column.name);
};

const getAiCredential = async ({ workspaceId, userId }) => {
    const result = await query(
        `SELECT provider, api_key_encrypted, model_id
         FROM ai_settings
         WHERE workspace_id = $1
           AND user_id = $2
           AND COALESCE(api_key_encrypted, '') <> ''`,
        [workspaceId, userId]
    );

    const rows = result.rows || [];
    const pick = (provider) => rows.find((row) => normalizeToken(row.provider) === provider);

    return pick('openai') || pick('anthropic') || pick('gemini') || null;
};

const createTimeoutController = (timeoutMs = 12000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
        signal: controller.signal,
        clear: () => clearTimeout(timer),
    };
};

const callOpenAiDefinition = async ({ apiKey, modelId, prompt }) => {
    const timeout = createTimeoutController();
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelId || 'gpt-5.1',
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [
                    {
                        role: 'system',
                        content: 'Return strict JSON only.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            }),
            signal: timeout.signal,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error?.message || `OpenAI error ${response.status}`);
        }
        return parseJsonObject(payload?.choices?.[0]?.message?.content);
    } finally {
        timeout.clear();
    }
};

const callAnthropicDefinition = async ({ apiKey, modelId, prompt }) => {
    const timeout = createTimeoutController();
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: modelId || 'claude-sonnet-4-20250514',
                temperature: 0.1,
                max_tokens: 700,
                system: 'Return strict JSON only.',
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: timeout.signal,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error?.message || `Anthropic error ${response.status}`);
        }

        const text = payload?.content?.[0]?.text || '';
        return parseJsonObject(text);
    } finally {
        timeout.clear();
    }
};

const callGeminiDefinition = async ({ apiKey, modelId, prompt }) => {
    const timeout = createTimeoutController();
    try {
        const targetModel = modelId || 'gemini-2.5-flash';
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                },
            }),
            signal: timeout.signal,
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error?.message || `Gemini error ${response.status}`);
        }

        const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return parseJsonObject(text);
    } finally {
        timeout.clear();
    }
};

const parseDefinitionPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;

    const definition = normalizeText(
        payload.definition
        || payload.tableDefinition
        || payload.summary
        || payload.description
    );
    if (!definition) return null;

    const numericConfidence = Number(payload.confidence);
    const confidence = Number.isFinite(numericConfidence)
        ? Math.round(clamp(numericConfidence, 0, 1) * 100) / 100
        : null;

    const signals = Array.isArray(payload.signals)
        ? payload.signals.map((item) => normalizeText(item)).filter(Boolean).slice(0, 6)
        : [];

    return {
        definition: definition.slice(0, 1200),
        confidence,
        signals,
    };
};

const hasToken = (text, tokens) => {
    const value = normalizeToken(text);
    return tokens.some((token) => value.includes(token));
};

const findColumnsByPattern = (schema, pattern) => {
    return schema.filter((column) => pattern.test(normalizeToken(column.name)));
};

const uniqueList = (items) => Array.from(new Set((items || []).filter(Boolean)));

const inferDomainFromColumns = ({ schema, tableName, datasetName }) => {
    const seed = `${tableName || ''} ${datasetName || ''} ${schema.map((column) => column.name).join(' ')}`.toLowerCase();
    if (hasToken(seed, ['ad', 'ads', 'campaign', 'click', 'impression', 'ctr', 'cvr', 'roas', 'spend'])) {
        return 'marketing/ads performance';
    }
    if (hasToken(seed, ['revenue', 'profit', 'cost', 'invoice', 'payment', 'pnl', 'finance'])) {
        return 'finance and business performance';
    }
    if (hasToken(seed, ['order', 'product', 'sku', 'shop', 'customer', 'gmv', 'sales'])) {
        return 'sales and commerce operations';
    }
    if (hasToken(seed, ['user', 'session', 'event', 'login', 'active'])) {
        return 'user behavior tracking';
    }
    return 'operational analytics';
};

const buildHeuristicDefinition = ({ tableName, datasetName, schema }) => {
    const safeSchema = sanitizeSchema(schema);
    const fullName = [datasetName, tableName].filter(Boolean).join('.');
    if (safeSchema.length === 0) {
        return {
            definition: `Table ${fullName || 'this table'} has no schema metadata yet, so definition cannot be inferred automatically.`,
            confidence: 0.2,
            signals: [],
        };
    }

    const timeColumns = findColumnsByPattern(safeSchema, /(date|time|timestamp|created|updated|_at$|month|year|day|week|period)/i);
    const idColumns = findColumnsByPattern(safeSchema, /(^id$|_id$|uuid|code$|key$)/i);
    const metricColumns = findColumnsByPattern(safeSchema, /(amount|price|cost|revenue|sales|qty|quantity|count|total|profit|margin|rate|value|spend|click|impression|gmv|tax|discount|score)/i);
    const dimensionColumns = safeSchema.filter((column) => {
        const name = normalizeToken(column.name);
        if (!name) return false;
        if (/(date|time|timestamp|created|updated|_at$|month|year|day|week|period)/i.test(name)) return false;
        if (/(^id$|_id$|uuid|code$|key$)/i.test(name)) return false;
        if (/(amount|price|cost|revenue|sales|qty|quantity|count|total|profit|margin|rate|value|spend|click|impression|gmv|tax|discount|score)/i.test(name)) return false;
        return /(name|category|type|status|channel|source|campaign|brand|product|sku|customer|segment|region|country|city|platform|store|shop|department)/i.test(name);
    });

    const domain = inferDomainFromColumns({ schema: safeSchema, tableName, datasetName });
    const grain = timeColumns.length > 0
        ? 'time-series fact-like table'
        : (metricColumns.length <= 1 && idColumns.length > 0 ? 'dimension/master table' : 'analytical fact table');

    const topSignals = uniqueList([
        ...timeColumns.slice(0, 2).map((column) => column.name),
        ...metricColumns.slice(0, 2).map((column) => column.name),
        ...dimensionColumns.slice(0, 2).map((column) => column.name),
    ]).slice(0, 5);

    const details = [];
    if (idColumns.length > 0) details.push(`keys (${idColumns.slice(0, 3).map((column) => column.name).join(', ')})`);
    if (timeColumns.length > 0) details.push(`time fields (${timeColumns.slice(0, 3).map((column) => column.name).join(', ')})`);
    if (metricColumns.length > 0) details.push(`metrics (${metricColumns.slice(0, 4).map((column) => column.name).join(', ')})`);
    if (dimensionColumns.length > 0) details.push(`dimensions (${dimensionColumns.slice(0, 4).map((column) => column.name).join(', ')})`);

    let confidenceScore = 0.45;
    if (timeColumns.length > 0) confidenceScore += 0.15;
    if (metricColumns.length > 0) confidenceScore += 0.15;
    if (idColumns.length > 0) confidenceScore += 0.1;
    if (dimensionColumns.length > 0) confidenceScore += 0.1;
    if (safeSchema.length >= 8) confidenceScore += 0.05;

    const confidence = Math.round(clamp(confidenceScore, 0.35, 0.95) * 100) / 100;
    const body = details.length > 0 ? ` Main evidence: ${details.join('; ')}.` : '';

    return {
        definition: `Table ${fullName || tableName || 'this table'} is likely a ${grain} for ${domain}.${body}`,
        confidence,
        signals: topSignals,
    };
};

const buildAiPrompt = ({ tableName, datasetName, schema }) => {
    const limitedColumns = sanitizeSchema(schema).slice(0, 160);
    return JSON.stringify({
        task: 'Infer business definition of an analytics table from schema metadata.',
        output_language: 'English',
        constraints: [
            'Return JSON object only.',
            'Keep definition concise (max 90 words).',
            'Do not invent columns that are not in schema.',
            'Confidence must be a number between 0 and 1.',
        ],
        output_schema: {
            definition: 'string',
            confidence: 'number',
            signals: ['string'],
        },
        input: {
            tableName: normalizeText(tableName),
            datasetName: normalizeText(datasetName),
            columns: limitedColumns,
        },
    });
};

const tryGenerateByProvider = async ({ provider, apiKey, modelId, prompt }) => {
    if (provider === 'openai') return callOpenAiDefinition({ apiKey, modelId, prompt });
    if (provider === 'anthropic') return callAnthropicDefinition({ apiKey, modelId, prompt });
    if (provider === 'gemini') return callGeminiDefinition({ apiKey, modelId, prompt });
    return null;
};

const generateTableDefinition = async ({
    workspaceId,
    userId,
    tableName,
    datasetName,
    schema,
}) => {
    const normalizedSchema = sanitizeSchema(schema);
    const fallback = buildHeuristicDefinition({
        tableName,
        datasetName,
        schema: normalizedSchema,
    });

    const credential = await getAiCredential({ workspaceId, userId });
    if (!credential) {
        return {
            ...fallback,
            source: 'heuristic',
            provider: null,
            modelId: null,
        };
    }

    const provider = normalizeToken(credential.provider);
    const apiKey = normalizeText(credential.api_key_encrypted);
    if (!apiKey) {
        return {
            ...fallback,
            source: 'heuristic',
            provider: null,
            modelId: null,
        };
    }

    try {
        const prompt = buildAiPrompt({
            tableName,
            datasetName,
            schema: normalizedSchema,
        });
        const aiRaw = await tryGenerateByProvider({
            provider,
            apiKey,
            modelId: credential.model_id,
            prompt,
        });
        const aiParsed = parseDefinitionPayload(aiRaw);
        if (!aiParsed) {
            throw new Error('AI response does not match expected format');
        }

        return {
            ...aiParsed,
            source: 'ai',
            provider: credential.provider,
            modelId: credential.model_id || null,
        };
    } catch (err) {
        console.warn('[table-definition] AI generation failed, fallback to heuristic:', err.message);
        return {
            ...fallback,
            source: 'heuristic',
            provider: null,
            modelId: null,
        };
    }
};

module.exports = {
    generateTableDefinition,
};
