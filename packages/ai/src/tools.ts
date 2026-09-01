import type { AiToolDefinition } from './types.ts';

/**
 * The AI Gateway's entire closed tool set (blueprint Part 05, "risk table").
 * This is intentionally the ONLY way the AI can touch data -- there is no
 * generic "run SQL" or "call any RPC" tool, and the Edge Function's executor
 * map (ai-gateway/tools.ts) only knows how to run exactly these eight names.
 * Anything the model asks for outside this list is rejected before any
 * authorization check even runs.
 *
 * riskLevel/requiresConfirmation come straight from the blueprint:
 *  - low:    read-only, never confirmed.
 *  - medium: single-record writes, always confirmed with a plain-language
 *            summary of what will change.
 *  - high:   multi-record or restaurant-wide writes, always confirmed with
 *            an explicit record count / diff, never auto-approved regardless
 *            of who is asking.
 */
export const AI_TOOLS: AiToolDefinition[] = [
  {
    name: 'findAvailability',
    description:
      "Find open tables for a restaurant at a given time window and party size. Read-only -- use this before proposing createReservation or modifyReservation, never guess availability.",
    riskLevel: 'low',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string', format: 'uuid' },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        partySize: { type: 'integer', minimum: 1 },
      },
      required: ['restaurantId', 'startsAt', 'endsAt', 'partySize'],
    },
  },
  {
    name: 'getReservation',
    description: 'Look up a single reservation by id, including its assigned tables and status.',
    riskLevel: 'low',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: { reservationId: { type: 'string', format: 'uuid' } },
      required: ['reservationId'],
    },
  },
  {
    name: 'getAnalytics',
    description: 'Aggregate reservation counts, no-show rate, average party size and covers for a restaurant over a date range.',
    riskLevel: 'low',
    requiresConfirmation: false,
    inputSchema: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string', format: 'uuid' },
        dateFrom: { type: 'string', format: 'date' },
        dateTo: { type: 'string', format: 'date' },
      },
      required: ['restaurantId', 'dateFrom', 'dateTo'],
    },
  },
  {
    name: 'createReservation',
    description: 'Create a new reservation for a restaurant, with smart table allocation. Requires user confirmation before it is actually booked.',
    riskLevel: 'medium',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string', format: 'uuid' },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        partySize: { type: 'integer', minimum: 1 },
        customerId: { type: 'string', format: 'uuid', nullable: true },
        guestName: { type: 'string', nullable: true },
        guestPhone: { type: 'string', nullable: true },
        specialRequests: { type: 'string', nullable: true },
      },
      required: ['restaurantId', 'startsAt', 'endsAt', 'partySize'],
    },
  },
  {
    name: 'modifyReservation',
    description: 'Change the time, party size and/or tables of an existing reservation. Requires user confirmation before it is applied.',
    riskLevel: 'medium',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        reservationId: { type: 'string', format: 'uuid' },
        startsAt: { type: 'string', format: 'date-time' },
        endsAt: { type: 'string', format: 'date-time' },
        partySize: { type: 'integer', minimum: 1 },
      },
      required: ['reservationId', 'startsAt', 'endsAt', 'partySize'],
    },
  },
  {
    name: 'cancelReservation',
    description: 'Cancel exactly one reservation. Requires user confirmation before it is applied.',
    riskLevel: 'medium',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        reservationId: { type: 'string', format: 'uuid' },
        reason: { type: 'string', nullable: true },
      },
      required: ['reservationId'],
    },
  },
  {
    name: 'bulkCancelReservations',
    description:
      'Cancel multiple reservations at once (e.g. "cancel every booking tonight because we are closing early"). High risk -- the confirmation must show the exact number of reservations that will be cancelled before anything happens.',
    riskLevel: 'high',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        reservationIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
        reason: { type: 'string', nullable: true },
      },
      required: ['reservationIds'],
    },
  },
  {
    name: 'updateRestaurantSettings',
    description:
      'Change restaurant profile/policy settings (booking window, party size limits, turnover buffer, contact details). High risk -- always confirmed, and only the fields explicitly listed in the input are changed.',
    riskLevel: 'high',
    requiresConfirmation: true,
    inputSchema: {
      type: 'object',
      properties: {
        restaurantId: { type: 'string', format: 'uuid' },
        patch: { type: 'object' },
      },
      required: ['restaurantId', 'patch'],
    },
  },
];

export function findToolDefinition(name: string): AiToolDefinition | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}
