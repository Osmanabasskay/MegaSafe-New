import { Redirect } from 'expo-router';

// Show welcome screen as the entry point
export default function Index() {
  return <Redirect href="/welcome" />;
}
