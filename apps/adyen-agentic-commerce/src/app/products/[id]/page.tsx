// Spec: knowledge/components/adyen-agentic-commerce.md
import Link from "next/link";
import { notFound } from "next/navigation";
import { VariantPicker } from "@/components/VariantPicker";
import { productById, variantsOf } from "@/server/catalog";

export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const product = productById((await params).id);
  if (!product) notFound();
  const variants = variantsOf(product).map((v) => ({ id: v.id, colour: v.colour.label, colourId: v.colour.id, hex: v.colour.hex, size: v.size, available: v.available }));
  const { variant } = await searchParams;
  return (
    <div className="space-y-6">
      <Link href={`/shop?category=${product.category}`} className="text-sm text-muted underline">← {product.category}</Link>
      <VariantPicker
        product={{ id: product.id, title: product.title, description: product.description, price: product.price, tags: product.tags }}
        variants={variants}
        initial={variants.some((v) => v.id === variant) ? variant : undefined}
      />
    </div>
  );
}
