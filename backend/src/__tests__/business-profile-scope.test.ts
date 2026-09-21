import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  branchFindFirst: vi.fn(),
  branchFindMany: vi.fn(),
  businessFindMany: vi.fn(),
  getSettingValue: vi.fn(),
  resolveBrand: vi.fn(),
}));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    branch: { findFirst: mocks.branchFindFirst, findMany: mocks.branchFindMany },
    business: { findMany: mocks.businessFindMany },
  },
}));

vi.mock('../services/settings.service.js', () => ({
  getSettingValue: mocks.getSettingValue,
}));

vi.mock('../services/branches.service.js', () => ({
  resolveBrand: mocks.resolveBrand,
}));

import { getBusinessProfile } from '../services/business-profile.service.js';

const BRAND = {
  storeName: 'Fallback',
  storeAddress: '',
  storeSupportEmail: '',
  storeSupportPhone: '',
  storeTaxId: '',
  storeLogoUrl: '',
  storeCurrency: 'AED',
};

describe('business profile scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettingValue.mockResolvedValue('');
    mocks.resolveBrand.mockResolvedValue(BRAND);
    mocks.branchFindMany.mockResolvedValue([]);
  });

  it('selects the business through the active branch and returns only its branches', async () => {
    mocks.branchFindFirst.mockResolvedValue({
      business: { id: 'business-a', name: 'Business A', legalName: null },
    });

    const profile = await getBusinessProfile('branch-a');

    expect(profile.name).toBe('Business A');
    expect(mocks.businessFindMany).not.toHaveBeenCalled();
    expect(mocks.branchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'business-a', isActive: true } }),
    );
    expect(mocks.resolveBrand).toHaveBeenCalledWith('branch-a', expect.any(Object));
  });

  it('fails closed when an unscoped caller could refer to several businesses', async () => {
    mocks.businessFindMany.mockResolvedValue([
      { id: 'business-a', name: 'Business A', legalName: null },
      { id: 'business-b', name: 'Business B', legalName: null },
    ]);

    await expect(getBusinessProfile()).rejects.toMatchObject({
      statusCode: 400,
      details: { reason: 'BRANCH_REQUIRED_MULTIPLE_BUSINESSES' },
    });
    expect(mocks.resolveBrand).not.toHaveBeenCalled();
    expect(mocks.getSettingValue).not.toHaveBeenCalled();
    expect(mocks.branchFindMany).not.toHaveBeenCalled();
  });

  it('keeps the unscoped zero-or-one-business compatibility path explicit', async () => {
    mocks.businessFindMany.mockResolvedValue([
      { id: 'business-a', name: 'Business A', legalName: 'Business A LLC' },
    ]);

    const profile = await getBusinessProfile();

    expect(profile.name).toBe('Business A');
    expect(profile.legalName).toBe('Business A LLC');
    expect(mocks.resolveBrand).toHaveBeenCalledWith(null, expect.any(Object));
  });

  it('does not fall back to another business for an unknown branch', async () => {
    mocks.branchFindFirst.mockResolvedValue(null);
    await expect(getBusinessProfile('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.businessFindMany).not.toHaveBeenCalled();
    expect(mocks.getSettingValue).not.toHaveBeenCalled();
  });
});
