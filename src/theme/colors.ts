export const lightColors = {
  bg: '#FFFFFF',
  bgSoft: '#F8FAFC',
  card: '#FFFFFF',
  text: '#1E2B5A',
  textSub: '#6B7280',
  textMuted: '#9CA3AF',
  border: '#F3F4F6',
  borderStrong: '#E5E7EB',
  inputBg: '#F9FAFB',
  tabBar: '#FFFFFF',
  tabBorder: '#F3F4F6',
  iconBg: '#F3F4F6',
  switchOff: '#E5E7EB',
  statusBar: 'dark-content' as const,
};

export const darkColors = {
  bg: '#0F172A',
  bgSoft: '#1E293B',
  card: '#1E293B',
  text: '#F1F5F9',
  textSub: '#94A3B8',
  textMuted: '#64748B',
  border: '#1E293B',
  borderStrong: '#334155',
  inputBg: '#1E293B',
  tabBar: '#1E293B',
  tabBorder: '#334155',
  iconBg: '#334155',
  switchOff: '#334155',
  statusBar: 'light-content' as const,
};

export type AppColors = typeof lightColors | typeof darkColors;
