import { apiFetch } from '@/lib/api';

/** Client for `/campaigns` — customer email and SMS campaigns. */

export type CampaignChannel = 'EMAIL' | 'SMS';
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'COMPLETED' | 'CANCELED' | 'FAILED';
export type ChannelProblem = 'publicUrlMissing' | 'emailNotConfigured' | 'smsNotConfigured';

export interface CampaignAudience {
  mode: 'filter' | 'manual';
  branchId?: string;
  productIds?: string[];
  categoryIds?: string[];
  inactiveDays?: number;
  customerType?: 'new' | 'returning';
  minSpend?: string;
  maxSpend?: string;
  customerIds?: string[];
}

export interface CampaignInput {
  name: string;
  channel: CampaignChannel;
  subjectEn?: string | null;
  subjectAr?: string | null;
  bodyEn?: string | null;
  bodyAr?: string | null;
  discountCode?: string | null;
  branchId?: string | null;
  audience: CampaignAudience;
}

export interface Campaign extends Required<Omit<CampaignInput, 'audience'>> {
  id: string;
  status: CampaignStatus;
  audience: CampaignAudience;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  audienceSize: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  outcomes: { pending: number; sent: number; delivered: number; failed: number; bounced: number };
}

export interface AudiencePreview {
  matched: number;
  eligible: number;
  excluded: { noConsent: number; noAddress: number; suppressed: number };
  sample: string[];
  sms: { segmentsPerMessage: number; totalSegments: number; estimatedCost: string | null } | null;
  largeAudienceThreshold: number;
}

export type CampaignReadiness = Record<CampaignChannel, { ready: boolean; problems: ChannelProblem[] }>;

export async function fetchCampaignReadiness(): Promise<CampaignReadiness> {
  return apiFetch<CampaignReadiness>('/campaigns/readiness');
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  return (await apiFetch<{ campaigns: Campaign[] }>('/campaigns')).campaigns;
}

export async function fetchCampaign(id: string): Promise<Campaign> {
  return (await apiFetch<{ campaign: Campaign }>(`/campaigns/${encodeURIComponent(id)}`)).campaign;
}

export async function saveCampaign(input: CampaignInput, id?: string): Promise<Campaign> {
  const body = await apiFetch<{ campaign: Campaign }>(id ? `/campaigns/${encodeURIComponent(id)}` : '/campaigns', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(input),
  });
  return body.campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  await apiFetch<void>(`/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function previewCampaignAudience(input: {
  channel: CampaignChannel;
  audience: CampaignAudience;
  bodyEn?: string | null;
  bodyAr?: string | null;
}): Promise<AudiencePreview> {
  return apiFetch<AudiencePreview>('/campaigns/preview-audience', { method: 'POST', body: JSON.stringify(input) });
}

export async function testSendCampaign(id: string, phone?: string): Promise<void> {
  await apiFetch<void>(`/campaigns/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    body: JSON.stringify(phone ? { phone } : {}),
  });
}

export async function sendCampaign(id: string, input: { sendAt?: string; confirmRecipients?: number }): Promise<Campaign> {
  const body = await apiFetch<{ campaign: Campaign }>(`/campaigns/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.campaign;
}

export async function cancelCampaign(id: string): Promise<Campaign> {
  const body = await apiFetch<{ campaign: Campaign }>(`/campaigns/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  return body.campaign;
}