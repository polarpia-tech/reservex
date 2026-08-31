import { createSupabaseClient } from '@reservex/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Expo exposes env vars prefixed EXPO_PUBLIC_ to the client bundle at build
// time. Anything without that prefix (e.g. a service role key) is simply
// never available here -- that's the platform's own safety net, on top of
// the one documented in .env.example.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? (Constants.expoConfig?.extra?.supabaseUrl as string | undefined) ?? '';
const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined) ?? '';

// React Native has no window.localStorage -- without this, sessions would
// not survive an app restart and every launch would force a fresh login.
export const supabase = createSupabaseClient({ url, anonKey, storage: AsyncStorage });
