<template>
  <div>
    <!-- AuthorizerRoot renders login, signup, magic-link and forgot-password views -->
    <authorizer-root :onLogin="onAuth" :onSignup="onAuth" />
  </div>
</template>

<script>
import { inject, watch } from 'vue';
import { useRouter } from 'vue-router';
import { AuthorizerRoot } from '@authorizerdev/authorizer-vue';

export default {
  name: 'Login',
  components: { 'authorizer-root': AuthorizerRoot },
  setup() {
    const useAuthorizer = inject('useAuthorizer');
    const { token } = useAuthorizer();
    const router = useRouter();

    // Redirect to the profile page once a token is available
    // (covers login, signup and an already-active session).
    watch(
      token,
      (value) => {
        if (value) {
          router.push('/profile');
        }
      },
      { immediate: true },
    );

    const onAuth = () => {
      router.push('/profile');
    };

    return { onAuth };
  },
};
</script>
