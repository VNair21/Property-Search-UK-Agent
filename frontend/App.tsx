import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type FrequencyOption = 'Hourly' | 'Daily' | 'Weekly' | 'Monthly';

const frequencyOptions: FrequencyOption[] = ['Hourly', 'Daily', 'Weekly', 'Monthly'];

const normalizeBaseUrl = (rawBaseUrl: string): string => rawBaseUrl.replace(/\/$/, '');

const deriveDevHostFromBundle = (): string | null => {
  const scriptUrl = (NativeModules as { SourceCode?: { scriptURL?: string } }).SourceCode?.scriptURL;
  if (!scriptUrl) {
    return null;
  }

  try {
    const hostname = new URL(scriptUrl).hostname;
    return hostname || null;
  } catch (_error) {
    return null;
  }
};

const resolveApiBaseUrl = (): string => {
  const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return normalizeBaseUrl(configuredBaseUrl);
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  const derivedHost = deriveDevHostFromBundle();
  if (derivedHost) {
    return `http://${derivedHost}:8000`;
  }

  return 'http://localhost:8000';
};

const API_BASE_URL = resolveApiBaseUrl();
const buildApiUrl = (path: string): string => `${API_BASE_URL}${path}`;

const redisKeys = {
  websites: 'property_agent:websites',
  areas: 'property_agent:areas',
  criteria: 'property_agent:criteria',
  frequencyLabel: 'property_agent:frequency_label',
  frequencyMinutes: 'property_agent:frequency_minutes',
} as const;

const frequencyToMinutes: Record<FrequencyOption, number> = {
  Hourly: 60,
  Daily: 24 * 60,
  Weekly: 7 * 24 * 60,
  Monthly: 30 * 24 * 60,
};

export default function App() {
  const [websites, setWebsites] = useState<string>('');
  const [areas, setAreas] = useState<string>('');
  const [criteria, setCriteria] = useState<string>('');
  const [updateFrequency, setUpdateFrequency] = useState<FrequencyOption>('Daily');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isAgentRunning, setIsAgentRunning] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const statusLabel = useMemo(
    () => (isAgentRunning ? 'Agent Running' : 'Agent Stopped'),
    [isAgentRunning],
  );

  useEffect(() => {
    const loadSavedSearch = async () => {
      const readKey = async (key: string): Promise<string | null> => {
        const response = await fetch(buildApiUrl(`/kv/${key}`));
        if (!response.ok) {
          if (response.status === 404) {
            return null;
          }
          throw new Error(`Failed to load key "${key}"`);
        }

        const payload = (await response.json()) as { value: string };
        return payload.value;
      };

      try {
        const [savedWebsites, savedAreas, savedCriteria, savedFrequency] = await Promise.all([
          readKey(redisKeys.websites),
          readKey(redisKeys.areas),
          readKey(redisKeys.criteria),
          readKey(redisKeys.frequencyLabel),
        ]);

        if (savedWebsites !== null) {
          setWebsites(savedWebsites);
        }
        if (savedAreas !== null) {
          setAreas(savedAreas);
        }
        if (savedCriteria !== null) {
          setCriteria(savedCriteria);
        }
        if (savedFrequency !== null && (frequencyOptions as string[]).includes(savedFrequency)) {
          setUpdateFrequency(savedFrequency as FrequencyOption);
        }
      } catch (error) {
        setStatusMessage(
          `Could not load saved search configuration: ${(error as Error).message}`,
        );
      }
    };

    void loadSavedSearch();
  }, []);

  const onStartAgent = async () => {
    setIsSaving(true);
    setStatusMessage('');
    const frequencyMinutes = frequencyToMinutes[updateFrequency].toString();
    const valuesByKey: Record<string, string> = {
      [redisKeys.websites]: websites,
      [redisKeys.areas]: areas,
      [redisKeys.criteria]: criteria,
      [redisKeys.frequencyLabel]: updateFrequency,
      [redisKeys.frequencyMinutes]: frequencyMinutes,
    };

    try {
      await Promise.all(
        payloads.map(async ({ key, value }) => {
          const response = await fetch(buildApiUrl(`/kv/${key}`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value }),
          });

      if (!response.ok) {
        throw new Error('Failed to save search configuration atomically');
      }

      setIsAgentRunning(true);
      setStatusMessage(`Search saved. Update frequency stored as ${frequencyMinutes} minutes.`);
    } catch (error) {
      setIsAgentRunning(false);
      setStatusMessage(`Failed to save search: ${(error as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const onCancelAgent = () => {
    setIsAgentRunning(false);
  };

  const onSelectFrequency = (option: FrequencyOption) => {
    setUpdateFrequency(option);
    setIsDropdownOpen(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>Property Search Agent</Text>

        <View style={styles.card}>
          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Websites to Search</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter websites..."
              placeholderTextColor="#8f939b"
              value={websites}
              onChangeText={setWebsites}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Areas to Search</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter areas..."
              placeholderTextColor="#8f939b"
              value={areas}
              onChangeText={setAreas}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Property Criteria</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter criteria..."
              placeholderTextColor="#8f939b"
              value={criteria}
              onChangeText={setCriteria}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.fieldBlock}>
            <Text style={styles.label}>Update Frequency</Text>
            <Pressable style={styles.dropdownTrigger} onPress={() => setIsDropdownOpen((prev) => !prev)}>
              <Text style={styles.dropdownValue}>{updateFrequency}</Text>
              <Text style={styles.dropdownChevron}>⌄</Text>
            </Pressable>

            {isDropdownOpen ? (
              <View style={styles.dropdownMenu}>
                {frequencyOptions.map((option) => {
                  const isSelected = option === updateFrequency;
                  return (
                    <Pressable
                      key={option}
                      style={[styles.dropdownItem, isSelected ? styles.dropdownItemSelected : undefined]}
                      onPress={() => onSelectFrequency(option)}
                    >
                      <Text style={styles.dropdownItemText}>{option}</Text>
                      {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.actionCard}>
          <Pressable
            style={[styles.primaryButton, isSaving ? styles.primaryButtonDisabled : undefined]}
            onPress={() => void onStartAgent()}
            disabled={isSaving}
          >
            <Text style={styles.primaryButtonText}>
              {isSaving ? 'Saving...' : 'Set Property Agent Search'}
            </Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onCancelAgent}>
            <Text style={styles.secondaryButtonText}>Cancel Property Agent</Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, isAgentRunning ? styles.statusDotRunning : styles.statusDotStopped]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        {statusMessage ? <Text style={styles.statusMessage}>{statusMessage}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f7',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 36,
  },
  header: {
    fontSize: 52 / 2,
    fontWeight: '600',
    color: '#161923',
    marginBottom: 22,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  fieldBlock: {
    paddingVertical: 10,
  },
  label: {
    fontSize: 21 / 2,
    fontWeight: '600',
    color: '#1c2029',
    marginBottom: 10,
  },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: '#dedee3',
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 18,
    color: '#202431',
    backgroundColor: '#f7f7fa',
  },
  divider: {
    height: 1,
    backgroundColor: '#ececf1',
    marginVertical: 6,
  },
  dropdownTrigger: {
    height: 52,
    borderWidth: 1,
    borderColor: '#dedee3',
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: '#f7f7fa',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownValue: {
    fontSize: 18,
    color: '#202431',
  },
  dropdownChevron: {
    fontSize: 24,
    color: '#7f8490',
    marginTop: -4,
  },
  dropdownMenu: {
    marginTop: 10,
    marginHorizontal: 8,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e6eb',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
    overflow: 'hidden',
  },
  dropdownItem: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#efeff4',
  },
  dropdownItemSelected: {
    backgroundColor: '#f4f4f8',
  },
  dropdownItemText: {
    fontSize: 18,
    color: '#202431',
  },
  checkmark: {
    fontSize: 18,
    color: '#555b68',
    fontWeight: '700',
  },
  actionCard: {
    marginTop: 22,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  primaryButton: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#121727',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cfd3dd',
    backgroundColor: '#f8f9fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#222834',
    fontSize: 16,
    fontWeight: '600',
  },
  statusRow: {
    marginTop: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  statusDotRunning: {
    backgroundColor: '#54c469',
  },
  statusDotStopped: {
    backgroundColor: '#d45a58',
  },
  statusText: {
    fontSize: 20,
    color: '#38404f',
    fontWeight: '500',
  },
  statusMessage: {
    marginTop: 12,
    fontSize: 14,
    color: '#515765',
    textAlign: 'center',
  },
});
