export type Locale = 'ja' | 'en';

export interface CollectionSummary {
  slug: string;
  name: string;
  teaser: string;
  heroImageUrl: string | null;
  productCount: number;
}

export interface ProductCard {
  slug: string;
  name: string;
  category: string;
  priceJpy: number;
  imageUrl: string | null;
  occasions: string[];
  personalizable: boolean;
  inStockAt: string[];
}

export interface Product {
  locale: Locale;
  slug: string;
  sku: string;
  name: string;
  category: string;
  priceJpy: number;
  description: string;
  craftStory: string;
  dimensionsCm: { width: number; height: number; depth: number } | null;
  personalization: {
    offered: boolean;
    kinds: string[];
    leadDays: number | null;
  };
  images: Array<{ url: string; alt: string }>;
  occasions: string[];
  collection: { slug: string; name: string } | null;
  stock: Array<{ boutique: string; name: string; quantity: number }>;
}

export interface BoutiqueInfo {
  slug: string;
  name: string;
  city: string;
  address: string;
  hours: Array<{ weekday: string; opens: string; closes: string }>;
  openOnDate: boolean | null;
  hoursOnDate: { opens: string; closes: string } | null;
  stock: Array<{ product: string; quantity: number }>;
}

export interface Appointment {
  reference: string;
  status: 'requested' | 'confirmed';
  boutique: { slug: string; name: string };
  requestedFor: string;
  products: Array<{ slug: string; name: string }>;
  note: string;
  confirmationSent: boolean;
}
