import { DigitalLayout } from "@/components/Layout.tsx";
import BackOffice from "@/components/BackOffice.tsx";

export default function BackOfficePage() {
  return (
    <DigitalLayout path="/back-office">
      <header className="page-intro">
        <h1>Back Office</h1>
        <p>Every order, what happened to it, and what you can still do with it.</p>
      </header>
      <BackOffice />
    </DigitalLayout>
  );
}
