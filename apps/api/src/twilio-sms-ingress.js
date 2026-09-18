import twilio from 'twilio';
import { normalizePhone } from './domain.js';

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
const MAX_MEDIA_ITEMS = 10;

function valueOf(value) {
  return Array.isArray(value) ? String(value.at(-1) || '').trim() : String(value || '').trim();
}

function asBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

function failure(status, code, message) {
  return {ok: false, status, error: {code, message}};
}

function parseForm(rawBody) {
  const form = Object.create(null);
  for (const [key, value] of new URLSearchParams(rawBody)) {
    if (Object.hasOwn(form, key)) form[key] = Array.isArray(form[key]) ? [...form[key], value] : [form[key], value];
    else form[key] = value;
  }
  return form;
}

function mmsMetadata(form) {
  const requested = Number.parseInt(valueOf(form.NumMedia), 10);
  const count = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_MEDIA_ITEMS) : 0;
  const contentTypes = [];
  for (let index = 0; index < count; index += 1) {
    const type = valueOf(form[`MediaContentType${index}`]);
    if (type) contentTypes.push(type);
  }
  return {present: count > 0, count, content_types: [...new Set(contentTypes)], downloaded: false};
}

function allowedSenders(value) {
  return new Set(String(value || '').split(',').map(item => normalizePhone(item)).filter(Boolean));
}

function exactHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password && parsed.href === value;
  } catch {
    return false;
  }
}

export function twilioSmsIngressConfig(environment = process.env) {
  return {
    enabled: asBoolean(environment.TWILIO_LAB_INGRESS_ENABLED),
    authToken: String(environment.TWILIO_LAB_AUTH_TOKEN || ''),
    webhookUrl: String(environment.TWILIO_LAB_WEBHOOK_PUBLIC_URL || ''),
    labNumber: normalizePhone(environment.TWILIO_LAB_NUMBER),
    allowedFrom: allowedSenders(environment.TWILIO_LAB_ALLOWED_FROM)
  };
}

export function validateTwilioSmsWebhook({headers = {}, rawBody, config, appEnv, syntheticOnly}) {
  if (appEnv === 'production' || !syntheticOnly) return failure(403, 'TWILIO_INGRESS_LAB_ONLY', 'Twilio SMS ingress is limited to the synthetic LAB runtime.');
  if (!config.enabled) return failure(503, 'TWILIO_INGRESS_DISABLED', 'Twilio SMS ingress is disabled until Stage B configuration is approved.');
  if (!config.authToken || !config.webhookUrl || !config.labNumber) return failure(503, 'TWILIO_INGRESS_CONFIG_INCOMPLETE', 'Twilio LAB ingress requires a child Auth Token, LAB number, and exact HTTPS webhook URL.');
  if (!exactHttpsUrl(config.webhookUrl)) return failure(503, 'TWILIO_INGRESS_CONFIG_INVALID', 'Twilio LAB webhook URL must be an exact HTTPS URL.');
  const contentType = String(headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith(FORM_CONTENT_TYPE)) return failure(415, 'TWILIO_FORM_CONTENT_TYPE_REQUIRED', 'Twilio SMS ingress accepts application/x-www-form-urlencoded only.');
  const signature = String(headers['x-twilio-signature'] || '');
  if (!signature) return failure(401, 'TWILIO_SIGNATURE_MISSING', 'X-Twilio-Signature is required before Chameleon ingestion.');
  let form;
  try {
    form = parseForm(rawBody);
  } catch {
    return failure(400, 'TWILIO_FORM_BODY_INVALID', 'Twilio form payload could not be parsed.');
  }
  let signatureValid = false;
  try {
    signatureValid = twilio.validateRequest(config.authToken, signature, config.webhookUrl, form);
  } catch {
    return failure(403, 'TWILIO_SIGNATURE_INVALID', 'Twilio signature validation failed.');
  }
  if (!signatureValid) return failure(403, 'TWILIO_SIGNATURE_INVALID', 'Twilio signature validation failed.');
  const messageSid = valueOf(form.MessageSid);
  const from = normalizePhone(valueOf(form.From));
  const to = normalizePhone(valueOf(form.To));
  const body = valueOf(form.Body);
  if (!messageSid) return failure(400, 'TWILIO_MESSAGE_SID_REQUIRED', 'MessageSid is required after signature validation.');
  if (!from) return failure(422, 'TWILIO_FROM_INVALID', 'From must contain a normalizable phone number.');
  if (!body) return failure(400, 'TWILIO_BODY_REQUIRED', 'Body is required for SMS support ingestion.');
  if (to !== config.labNumber) return failure(403, 'TWILIO_LAB_NUMBER_MISMATCH', 'Inbound message does not target the configured LAB number.');
  if (config.allowedFrom.size && !config.allowedFrom.has(from)) return failure(403, 'TWILIO_FROM_NOT_ALLOWED', 'Inbound sender is not allowed for the configured LAB test scope.');
  const mms = mmsMetadata(form);
  return {
    ok: true,
    input: {
      source: 'synthetic',
      source_event_id: messageSid,
      idempotency_key: `twilio:message:${messageSid}`,
      channel: 'sms',
      sender: {phone: valueOf(form.From), external_participant_id: valueOf(form.From)},
      message: body,
      timestamp: valueOf(form.DateSent) || undefined,
      conversation_reference: valueOf(form.ConversationSid) || messageSid,
      metadata: {
        adapter: 'twilio-sms-ingress',
        transport: 'twilio',
        provider_event_id: messageSid,
        signature_validated: true,
        trusted_phone_order_context: true,
        mms,
        execution: 'NO_EXECUTION'
      }
    },
    receipt: {
      provider_event_id: messageSid,
      channel: 'sms',
      signature_validated: true,
      mms,
      execution: 'NO_EXECUTION'
    }
  };
}
