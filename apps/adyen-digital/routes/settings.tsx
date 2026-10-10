import { DigitalLayout } from "../components/Layout.tsx";
import ProfileManager from "../islands/ProfileManager.tsx";
import { define } from "../utils.ts";

export default define.page(function SettingsPage() {
  return (
    <DigitalLayout path="/settings">
      <header class="page-intro page-intro--narrow">
        <h1>Settings</h1>
        <p>Your Adyen TEST connection and the credential profiles the playground can use.</p>
      </header>
      <ProfileManager />
    </DigitalLayout>
  );
});
