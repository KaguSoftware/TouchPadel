import { Redirect } from 'expo-router';
import { useAuth } from '../src/features/auth/context';
import { Loading } from '../src/components/ui';

/** Entry: route by session. (auth) is public; everything else needs a session. */
export default function Index() {
  const { session, initializing } = useAuth();
  if (initializing) return <Loading />;
  return session ? <Redirect href="/(app)" /> : <Redirect href="/(auth)/sign-in" />;
}
