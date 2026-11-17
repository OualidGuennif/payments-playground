// Spec: knowledge/components/adyen-agentic-commerce.md
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/SignInForm";
import { currentCustomer, safeNext } from "@/lib/session";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  return <SignInForm mode="sign-in" next={next} />;
}
