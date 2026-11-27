export type StandardPptLanguage = 'zh-CN' | 'en-US';

export type StandardPptStyle =
  | 'professional'
  | 'minimal'
  | 'academic'
  | 'creative'
  | 'dark';

export type StandardPptSlideLayout =
  | 'title'
  | 'content'
  | 'two-column'
  | 'closing';

export interface StandardPptSlide {
  id: string;
  title: string;
  subtitle?: string;
  body?: string;
  bullets: string[];
  layout: StandardPptSlideLayout;
  notes?: string;
  imagePrompt?: string;
  imageData?: string;
}

export interface StandardPptOutline {
  title: string;
  subtitle?: string;
  slides: Array<{ title: string; purpose: string; layout?: 'content' | 'two-column' }>;
}

export interface StandardPptDeck {
  format: 'standard_pptx_v1';
  topic: string;
  title: string;
  subtitle?: string;
  language: StandardPptLanguage;
  style: StandardPptStyle;
  slideCount: number;
  includeImages: boolean;
  outline: StandardPptOutline['slides'];
  slides: StandardPptSlide[];
  generatedAt: string;
}

