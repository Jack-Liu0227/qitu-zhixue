export const PRODUCT_NAME = '启途智学';

export const colors = {
  page: '#F6FAFF',
  primary: '#2878F0',
  heading: '#102A5C',
  completed: '#18B7AC',
  attention: '#FF8A3D',
  danger: '#E95B68',
  border: '#E4ECF7',
  text: '#243B5A',
  muted: '#73839B',
} as const;

export type DesignColor = keyof typeof colors;
