import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './state/auth';
import { AuthScreen } from './screens/AuthScreen';
import { ChatScreen } from './screens/ChatScreen';
import { InviteRedeemer, useInviteNotice } from './components/InviteGate';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

function Shell() {
  const { status } = useAuth();
  const inviteNotice = useInviteNotice();

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ground">
        <span
          role="status"
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-hairline border-t-accent-ink"
        />
      </main>
    );
  }

  if (status === 'signedIn') {
    return (
      <>
        <ChatScreen />
        <InviteRedeemer />
      </>
    );
  }
  return <AuthScreen notice={inviteNotice} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </QueryClientProvider>
  );
}
