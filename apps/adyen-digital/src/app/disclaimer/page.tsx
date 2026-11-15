import { DisclaimerPage } from "@suite/ui/components.tsx";
import { DigitalLayout } from "@/components/Layout.tsx";

export default function Disclaimer() {
  return (
    <DigitalLayout path="/disclaimer">
      <DisclaimerPage
        appName="Digital Checkout"
        repositoryUrl="https://github.com/OualidGuennif/payments-playground"
      />
    </DigitalLayout>
  );
}
