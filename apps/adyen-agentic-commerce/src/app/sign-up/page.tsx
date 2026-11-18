// Spec: knowledge/components/adyen-agentic-commerce.md
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/SignInForm";
import { currentCustomer, safeNext } from "@/lib/session";

export const metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  return <SignInForm mode="sign-up" next={next} />;
}
