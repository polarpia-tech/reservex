/**
 * Hand-written TypeScript mirror of the Postgres schema from Phase 02
 * (supabase/migrations). Deliberately kept in lockstep with the SQL enums
 * and columns -- when a migration changes a shape, this file changes in the
 * same PR. (Once the schema stabilizes, this can be generated automatically
 * with `supabase gen types typescript`; hand-written for now while the
 * schema is still moving fast across phases.)
 */

export type UUID = string;
export type ISODateTime = string; // timestamptz, always UTC on the wire
export type ISODate = string; // date, "YYYY-MM-DD"

// ---- enums (see 0002-0010 migrations for the source of truth) -------------

export type StaffRole = 'owner' | 'manager' | 'reservation_manager' | 'host' | 'staff';

export type RestaurantType =
  | 'restaurant' | 'cafe' | 'bar' | 'club' | 'beach_venue' | 'hotel_venue' | 'event_venue';

export type TableZoneType =
  | 'indoor' | 'outdoor' | 'terrace' | 'garden' | 'bar'
  | 'vip' | 'private_room' | 'smoking' | 'non_smoking' | 'event';

export type TableStatus =
  | 'available' | 'reserved' | 'seated' | 'occupied' | 'cleaning' | 'blocked' | 'out_of_service';

export type TableShape = 'round' | 'square' | 'rectangle';

export type ReservationStatus =
  | 'pending' | 'confirmed' | 'seated' | 'completed' | 'cancelled' | 'no_show';

export type ReservationSource =
  | 'app' | 'web' | 'widget' | 'qr' | 'phone' | 'whatsapp' | 'sms' | 'walk_in' | 'admin';

// 'in_app' added in Phase 09 (migration 0016) -- the one channel this
// platform can currently deliver end to end (the inbox reads the same
// notifications row it's queued in, no external provider involved).
// push/email/sms/whatsapp rows are genuinely queued but NOT dispatched
// anywhere yet -- see the Phase 09 README section.
export type NotificationChannel = 'push' | 'email' | 'sms' | 'whatsapp' | 'in_app';

// ---- core entities ----------------------------------------------------

export interface Restaurant {
  id: UUID;
  organizationId: UUID;
  name: string;
  slug: string;
  restaurantType: RestaurantType;
  // Plain-text description in the STAFF's own working language -- not yet
  // exposed per-locale in any UI (see descriptionI18n below and the Phase 05
  // README note on why that editor was deliberately deferred).
  description: string | null;
  descriptionI18n: Partial<Record<'de' | 'en' | 'el' | 'tr', string>>;
  logoUrl: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null; // ISO 3166-1 alpha-2, e.g. 'DE', 'GR'
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  timezone: string; // IANA name -- authoritative local time for this restaurant
  defaultLocale: string;
  supportedLocales: string[];
  seatingCapacityTotal: number | null;
  minPartySize: number;
  maxPartySize: number;
  defaultReservationDurationMin: number;
  defaultTurnoverBufferMin: number;
  bookingWindowMinHours: number;
  bookingWindowMaxDays: number;
  isActive: boolean;
}

// ---- Phase 05: restaurant profile, opening hours, staff ------------------

export interface OpeningHours {
  id: UUID;
  restaurantId: UUID;
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday, matches JS Date#getDay()
  label: string | null;
  opensAt: string; // "HH:MM:SS"
  closesAt: string; // "HH:MM:SS" -- closesAt <= opensAt means "crosses midnight"
  isClosed: boolean;
}

export interface SpecialHours {
  id: UUID;
  restaurantId: UUID;
  date: ISODate;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  reason: string | null;
}

export interface StaffMember {
  restaurantUserId: UUID;
  userId: UUID;
  email: string;
  role: StaffRole;
  isActive: boolean;
  invitedAt: ISODateTime;
  joinedAt: ISODateTime | null;
}

// ---- Phase 08: the customer-facing side of a booking -----------------------

/**
 * A single customer identity, shared across every restaurant they've ever
 * booked with (public.customers, migration 0005). `authUserId` is set once
 * they create a Supabase Auth account (customer login on the web app);
 * before that, a guest booking has no row here at all -- see
 * ReservationWithTables / Reservation's own guestName/guestPhone/guestEmail
 * fields for how a guest's details are actually stored on the reservation.
 */
export interface Customer {
  id: UUID;
  authUserId: UUID | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  preferredLocale: string;
  marketingOptIn: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface TableZone {
  id: UUID;
  restaurantId: UUID;
  name: string;
  zoneType: TableZoneType;
  sortOrder: number;
  isActive: boolean;
}

export interface RestaurantTable {
  id: UUID;
  restaurantId: UUID;
  zoneId: UUID | null;
  label: string;
  capacityMin: number;
  capacityMax: number;
  isVip: boolean;
  // Whether this table may be merged with a neighbour into a table
  // combination for a large party. The `table_combinations` /
  // `table_combination_members` tables (migration 0003) that would actually
  // USE this flag are not built into any screen yet -- combining tables is
  // a smart-allocation concern for Phase 07's reservation engine, not table
  // management itself, so there is no consumer of it in the UI until then.
  isCombinable: boolean;
  shape: TableShape;
  status: TableStatus;
  isActive: boolean;
}

export interface Reservation {
  id: UUID;
  restaurantId: UUID;
  customerId: UUID | null;
  eventId: UUID | null;
  status: ReservationStatus;
  source: ReservationSource;
  partySize: number;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  bufferMinutes: number;
  zonePreferenceId: UUID | null;
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  specialRequests: string | null;
  // Staff-only field -- never shown to the guest in any customer-facing
  // screen (that screen doesn't exist yet; this comment is a trip-wire for
  // whoever builds it in Phase 08).
  internalNotes: string | null;
  createdByUserId: UUID | null;
  createdByAi: boolean;
  confirmedAt: ISODateTime | null;
  seatedAt: ISODateTime | null;
  completedAt: ISODateTime | null;
  cancelledAt: ISODateTime | null;
  cancellationReason: string | null;
  noShowMarkedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ---- Phase 07: reservation engine ----------------------------------------

export interface ReservationTableAssignment {
  tableId: UUID;
  label: string;
}

/** A Reservation plus which physical table(s) are currently holding it -- the join Phase 07's list/detail screens actually need. */
export interface ReservationWithTables extends Reservation {
  tables: ReservationTableAssignment[];
}

/** One candidate returned by get_available_tables() -- a single physical table that fits and is free. */
export interface AvailableTable {
  tableId: UUID;
  label: string;
  zoneId: UUID | null;
  capacityMin: number;
  capacityMax: number;
  isVip: boolean;
}

/** One candidate returned by get_available_table_combinations() -- a predefined multi-table group that fits and is entirely free. */
export interface AvailableTableCombination {
  combinationId: UUID;
  name: string;
  combinedCapacityMin: number;
  combinedCapacityMax: number;
  tableIds: UUID[];
}

export interface TableCombination {
  id: UUID;
  restaurantId: UUID;
  name: string;
  combinedCapacityMin: number;
  combinedCapacityMax: number;
  isActive: boolean;
  tableIds: UUID[];
}

export type WaitlistStatus = 'waiting' | 'notified' | 'booked' | 'expired' | 'cancelled';

export interface WaitlistEntry {
  id: UUID;
  restaurantId: UUID;
  customerId: UUID | null;
  guestName: string | null;
  guestPhone: string | null;
  partySize: number;
  requestedDate: ISODate;
  // The window the guest would accept, e.g. 19:00-21:00 -- stored as a
  // Postgres tstzrange on the wire (see requestedTimeRangeRaw in the api
  // layer for the raw string); these two are the parsed bounds for display.
  requestedFrom: ISODateTime;
  requestedTo: ISODateTime;
  zonePreferenceId: UUID | null;
  status: WaitlistStatus;
  priorityScore: number;
  notifiedAt: ISODateTime | null;
  expiresAt: ISODateTime | null;
  convertedReservationId: UUID | null;
}

// ---- Phase 09: notifications (queueing + in-app inbox, migration 0016) ----

// 'guest' added in Phase 09 -- a Phase 08 guest reservation (no customer_id
// at all) needed a third recipient shape; see 0016's migration comment.
export type NotificationRecipientType = 'customer' | 'staff' | 'guest';

export type NotificationStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'read';

export interface Notification {
  id: UUID;
  restaurantId: UUID | null;
  recipientType: NotificationRecipientType;
  recipientCustomerId: UUID | null;
  recipientUserId: UUID | null;
  channel: NotificationChannel;
  /** e.g. 'reservation_created', 'reservation_confirmed', 'reservation_cancelled', 'reservation_reminder', 'reservation_rescheduled', 'no_show_recorded'. */
  templateCode: string;
  payload: Record<string, unknown>;
  status: NotificationStatus;
  reservationId: UUID | null;
  scheduledFor: ISODateTime | null;
  sentAt: ISODateTime | null;
  createdAt: ISODateTime;
}

/** event_type is free text by design (see 0008) -- 'new_reservation' | 'cancellation' | 'no_show' | 'reschedule' are the values Phase 09 actually triggers on. */
export interface StaffNotificationPreference {
  id: UUID;
  restaurantId: UUID;
  userId: UUID;
  eventType: string;
  channel: NotificationChannel;
  isEnabled: boolean;
}

export interface ReminderRule {
  id: UUID;
  restaurantId: UUID;
  name: string;
  minutesBeforeStart: number;
  channel: NotificationChannel;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Phase 10: AI Gateway (migration 0009 for the tables, 0017 for the one new
// SQL function). Matches public.ai_channel / ai_message_role / ai_action_
// status exactly (see supabase/migrations/0009_ai.sql). The concrete tool
// names/schemas the AI Gateway understands live in packages/ai, not here --
// packages/core deliberately only knows enough to call the Edge Function
// and render whatever it returns; it does not need the tool definitions
// themselves.
// ---------------------------------------------------------------------------
export type AiChannel = 'staff_chat' | 'customer_chat' | 'voice' | 'whatsapp';
export type AiMessageRole = 'user' | 'assistant' | 'tool';
export type AiActionStatus = 'proposed' | 'confirmed' | 'executed' | 'rejected' | 'failed';

export interface AiMessage {
  id: UUID;
  conversationId: UUID;
  role: AiMessageRole;
  content: string | null;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutput: Record<string, unknown> | null;
  createdAt: ISODateTime;
}

/** What the ai-gateway Edge Function returns from a `chat` call when the model answered in plain text (no tool call). */
export interface AiChatReply {
  conversationId: UUID;
  reply: string;
  actionId?: UUID;
  toolResult?: Record<string, unknown>;
}

/** What the ai-gateway Edge Function returns from a `chat` call when the model wants to run a tool that requires confirmation -- nothing has happened yet. */
export interface AiActionProposal {
  conversationId: UUID;
  proposal: {
    actionId: UUID;
    toolName: string;
    riskLevel: 'low' | 'medium' | 'high';
    summary: string;
  };
}

export type AiChatResponse = AiChatReply | AiActionProposal;

export function isAiActionProposal(response: AiChatResponse): response is AiActionProposal {
  return 'proposal' in response;
}

// ---------------------------------------------------------------------------
// Phase 12: Payments & billing (migration 0007's tables, extended by 0019).
// Matches public.deposit_applies_to / deposit_calc_type / payment_type /
// payment_status / billing_interval / subscription_status exactly.
// ---------------------------------------------------------------------------
export type DepositAppliesTo = 'all' | 'event' | 'vip' | 'party_size_threshold';
export type DepositCalcType = 'fixed' | 'per_person' | 'percentage';
export type PaymentType = 'deposit' | 'no_show_charge' | 'refund' | 'event_ticket';
export type PaymentStatus = 'requires_action' | 'requires_capture' | 'processing' | 'succeeded' | 'failed' | 'refunded' | 'cancelled';
export type BillingInterval = 'monthly' | 'yearly';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused';

export interface DepositPolicy {
  id: UUID;
  restaurantId: UUID;
  name: string;
  appliesTo: DepositAppliesTo;
  calculationType: DepositCalcType;
  amountCents: number | null;
  percentage: number | null;
  percentageBaseAmountCents: number | null;
  partySizeThreshold: number | null;
  cancellationWindowHours: number;
  refundPolicyText: string | null;
  isActive: boolean;
}

export interface Payment {
  id: UUID;
  restaurantId: UUID;
  reservationId: UUID | null;
  customerId: UUID | null;
  provider: string;
  providerPaymentId: string | null;
  paymentType: PaymentType;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  depositPolicyId: UUID | null;
  createdAt: ISODateTime;
}

/** What compute_deposit_amount() (0019) returns -- null when no deposit is required at all. */
export interface DepositQuote {
  policyId: UUID;
  amountCents: number;
}

export interface SubscriptionPlan {
  id: UUID;
  code: string;
  name: string;
  priceCents: number;
  billingInterval: BillingInterval;
  currency: string;
  limits: Record<string, unknown>;
  isActive: boolean;
}

export interface Subscription {
  id: UUID;
  organizationId: UUID;
  planId: UUID;
  status: SubscriptionStatus;
  trialEndsAt: ISODateTime | null;
  currentPeriodStart: ISODateTime | null;
  currentPeriodEnd: ISODateTime | null;
  cancelAtPeriodEnd: boolean;
}

// ---------------------------------------------------------------------------
// Phase 13: Admin πλατφόρμας. platform_admins/admin_* functions -- see
// migration 0020. Not restaurant-side data at all -- ReservX's own internal
// team looking across every organization/restaurant, never scoped to one.
// ---------------------------------------------------------------------------
export type PlatformAdminRole = 'super_admin' | 'support';

export interface PlatformAdmin {
  id: UUID;
  userId: UUID;
  email: string;
  role: PlatformAdminRole;
  isActive: boolean;
  grantedByEmail: string | null;
  createdAt: ISODateTime;
}

export interface AdminOrganizationSummary {
  organizationId: UUID;
  organizationName: string;
  ownerEmail: string;
  billingEmail: string | null;
  restaurantCount: number;
  subscriptionStatus: SubscriptionStatus | null;
  planCode: string | null;
  trialEndsAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface AdminRestaurantSummary {
  restaurantId: UUID;
  organizationId: UUID;
  name: string;
  slug: string;
  restaurantType: RestaurantType;
  city: string | null;
  countryCode: string | null;
  isActive: boolean;
  suspendedByPlatformAt: ISODateTime | null;
  suspensionReason: string | null;
  createdAt: ISODateTime;
}

export interface FeatureFlag {
  id: UUID;
  key: string;
  description: string | null;
  isEnabledDefault: boolean;
  rolloutPercentage: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface FeatureFlagOverride {
  id: UUID;
  flagId: UUID;
  organizationId: UUID | null;
  restaurantId: UUID | null;
  isEnabled: boolean;
  createdAt: ISODateTime;
}
