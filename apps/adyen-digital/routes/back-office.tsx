import { DigitalLayout } from "../components/Layout.tsx";
import BackOffice from "../islands/BackOffice.tsx";
import { define } from "../utils.ts";

export default define.page(function BackOfficePage() {
  return (
    <DigitalLayout path="/back-office">
      <header class="page-intro">
        <h1>Back Office</h1>
        <p>Every order, what happened to it, and what you can still do with it.</p>
      </header>
      <BackOffice />
    </DigitalLayout>
  );
});
