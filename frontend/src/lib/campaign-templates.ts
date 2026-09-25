/**
 * Starting copy for common campaigns, in BOTH languages at once — a template
 * fills the English and Arabic fields together whatever language the screen
 * is in, so this is content, not interface text, and lives here rather than
 * in the message catalogues.
 */

export type CampaignTemplate = 'discount' | 'clearance';

interface TemplateCopy {
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
  smsEn: string;
  smsAr: string;
}

export const CAMPAIGN_TEMPLATES: Record<CampaignTemplate, TemplateCopy> = {
  discount: {
    subjectEn: 'A little something from {{store_name}}',
    subjectAr: 'هدية صغيرة من {{store_name}}',
    bodyEn:
      'Hi {{customer_name}},\n\nThank you for shopping with us. Enjoy a discount on your next order with the code {{discount_code}}.\n\nSee you soon,\n{{store_name}}',
    bodyAr:
      'مرحبًا {{customer_name}}،\n\nشكرًا لتسوقك معنا. استمتع بخصم على طلبك القادم باستخدام الرمز {{discount_code}}.\n\nنراك قريبًا،\n{{store_name}}',
    smsEn: '{{store_name}}: Hi {{customer_name}}, enjoy a discount on your next order with code {{discount_code}}.',
    smsAr: '{{store_name}}: مرحبًا {{customer_name}}، استمتع بخصم على طلبك القادم بالرمز {{discount_code}}.',
  },
  clearance: {
    subjectEn: 'Clearance at {{store_name}}: while stocks last',
    subjectAr: 'تصفية في {{store_name}}: حتى نفاد الكمية',
    bodyEn:
      'Hi {{customer_name}},\n\nWe are clearing selected items at reduced prices while stocks last. Use {{discount_code}} at checkout.\n\n{{store_name}}',
    bodyAr:
      'مرحبًا {{customer_name}}،\n\nنقدّم تصفية على منتجات مختارة بأسعار مخفّضة حتى نفاد الكمية. استخدم الرمز {{discount_code}} عند الدفع.\n\n{{store_name}}',
    smsEn: '{{store_name}} clearance: selected items reduced while stocks last. Code {{discount_code}}.',
    smsAr: 'تصفية {{store_name}}: منتجات مختارة بأسعار مخفّضة حتى نفاد الكمية. الرمز {{discount_code}}.',
  },
};