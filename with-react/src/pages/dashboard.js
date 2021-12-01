import { useAuthorizer } from "@authorizerdev/authorizer-react";

export default function Dashboard() {
  const { token, user } = useAuthorizer();
  return (
    <div>
      <h1>Token</h1>
      <pre> {JSON.stringify(token, null, 6)}</pre>
      <h1>User</h1>
      <pre>{JSON.stringify(user, null, 2)}</pre>
    </div>
  );
}
