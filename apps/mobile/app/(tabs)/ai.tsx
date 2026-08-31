import {
  confirmAiAction,
  fetchAiConversationMessages,
  isAiActionProposal,
  rejectAiAction,
  sendAiChatMessage,
  type AiActionProposal,
  type AiMessage,
} from '@reservex/core';
import { radii, spacing, typeScale } from '@reservex/ui';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useMyRestaurant } from '@/hooks/useMyRestaurant';
import { supabase } from '@/services/supabase';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The staff AI chat -- Phase 10. This screen is real: it calls the real
 * ai-gateway Edge Function through @reservex/core's sendAiChatMessage(),
 * and a proposal from the model renders as a real confirm/reject card tied
 * to a real ai_actions row.
 *
 * What "real" does NOT mean here: this has not been exercised against a
 * live Anthropic endpoint (no network access / no ANTHROPIC_API_KEY in the
 * sandbox this was built in -- see supabase/functions/ai-gateway/index.ts's
 * header comment). Talking to this screen against an undeployed or
 * unconfigured function will surface a normal error state below, which is
 * the honest behavior of real code pointed at a backend that isn't live
 * yet -- not a simulated response.
 *
 * Scope: staff_chat only, single restaurant (see useMyRestaurant). No
 * voice input -- see packages/ai's VoiceNotImplementedError.
 */
export default function AssistantScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { membership } = useMyRestaurant();
  const restaurantId = membership?.restaurant.id;
  const queryClient = useQueryClient();

  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState('');
  const [proposal, setProposal] = useState<AiActionProposal['proposal'] | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const messagesQuery = useQuery({
    queryKey: ['ai-messages', conversationId],
    queryFn: () => fetchAiConversationMessages(supabase, conversationId!),
    enabled: Boolean(conversationId),
  });

  const invalidateMessages = () => void queryClient.invalidateQueries({ queryKey: ['ai-messages', conversationId] });

  const sendMutation = useMutation({
    mutationFn: () => sendAiChatMessage(supabase, { restaurantId: restaurantId!, message: input.trim(), conversationId }),
    onSuccess: (response) => {
      setInput('');
      setSendError(null);
      setConversationId(response.conversationId);
      if (isAiActionProposal(response)) {
        setProposal(response.proposal);
      } else {
        setProposal(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['ai-messages', response.conversationId] });
    },
    onError: (error: unknown) => {
      setSendError(error instanceof Error ? error.message : t('ai.sendFailed'));
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (actionId: string) => confirmAiAction(supabase, actionId),
    onSuccess: () => {
      setProposal(null);
      invalidateMessages();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (actionId: string) => rejectAiAction(supabase, actionId),
    onSuccess: () => {
      setProposal(null);
      invalidateMessages();
    },
  });

  const canSend = Boolean(restaurantId) && input.trim().length > 0 && !sendMutation.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        {!conversationId && !messagesQuery.data?.length ? (
          <Text style={{ color: theme.textMuted }}>{t('ai.emptyState')}</Text>
        ) : null}

        {(messagesQuery.data ?? []).map((message: AiMessage) => (
          <View
            key={message.id}
            style={[
              styles.bubble,
              {
                alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                backgroundColor: message.role === 'user' ? theme.accent : theme.surface,
                borderColor: theme.border,
              },
            ]}
          >
            <Text style={{ color: message.role === 'user' ? '#0B0C10' : theme.textPrimary }}>{message.content}</Text>
          </View>
        ))}

        {sendMutation.isPending ? (
          <View style={[styles.bubble, { alignSelf: 'flex-start', backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ActivityIndicator color={theme.ai} size="small" />
          </View>
        ) : null}

        {sendError ? (
          <Card style={{ borderColor: theme.danger }}>
            <Text style={{ color: theme.danger }}>{sendError}</Text>
          </Card>
        ) : null}

        {proposal ? (
          <Card style={{ borderColor: theme.ai, gap: spacing.sm }}>
            <View style={styles.proposalHeader}>
              <Ionicons name="sparkles" size={16} color={theme.ai} />
              <Text style={[styles.riskBadge, { color: theme.ai, borderColor: theme.ai }]}>
                {t(`ai.riskLevels.${proposal.riskLevel}`)}
              </Text>
            </View>
            <Text style={{ color: theme.textPrimary }}>{proposal.summary}</Text>
            <Text style={{ color: theme.textMuted }}>{t('ai.confirmAction')}</Text>
            <View style={styles.proposalActions}>
              <Button
                label={t('ai.rejectButton')}
                variant="neutral"
                onPress={() => rejectMutation.mutate(proposal.actionId)}
                loading={rejectMutation.isPending}
                disabled={confirmMutation.isPending}
              />
              <Button
                label={t('ai.confirmButton')}
                variant="ai"
                onPress={() => confirmMutation.mutate(proposal.actionId)}
                loading={confirmMutation.isPending}
                disabled={rejectMutation.isPending}
              />
            </View>
          </Card>
        ) : null}
      </ScrollView>

      <View style={[styles.inputBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="sparkles" size={18} color={theme.ai} />
        <TextInput
          value={input}
          onChangeText={setInput}
          editable={!sendMutation.isPending}
          placeholder={t('ai.placeholder') ?? undefined}
          placeholderTextColor={theme.textMuted}
          style={[styles.input, { color: theme.textPrimary }]}
          onSubmitEditing={() => canSend && sendMutation.mutate()}
          returnKeyType="send"
        />
        <Button label={t('ai.send')} variant="ai" onPress={() => sendMutation.mutate()} disabled={!canSend} loading={sendMutation.isPending} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.lg },
  bubble: { maxWidth: '85%', borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, fontSize: typeScale.body.size },
  proposalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  riskBadge: {
    ...typeScale.label,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  proposalActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
});
