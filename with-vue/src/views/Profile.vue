<template>
  <div v-if="user">
    <h2>Profile</h2>
    <pre>{{ JSON.stringify(user, null, 2) }}</pre>
    <button @click="onLogout">Logout</button>
  </div>
  <div v-else>
    <p>
      Not logged in.
      <router-link to="/">Go to login</router-link>
    </p>
  </div>
</template>

<script>
import { inject } from 'vue';
import { useRouter } from 'vue-router';

export default {
  name: 'Profile',
  setup() {
    const useAuthorizer = inject('useAuthorizer');
    const { user, setUser, setToken, authorizerRef } = useAuthorizer();
    const router = useRouter();

    const onLogout = async () => {
      await authorizerRef.value.logout();
      setUser.value(null);
      setToken.value(null);
      router.push('/');
    };

    return { user, onLogout };
  },
};
</script>
