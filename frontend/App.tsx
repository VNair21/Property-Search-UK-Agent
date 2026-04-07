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
type AgentFinding = {
  rank: number;
  property: string;
  price: string;
  size_sqm: string;
  pounds_per_sqm: string;
  service_charge: string;
  ground_rent: string;
  location: string;
  key_strengths: string;
  main_issues: string;
};

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

const findingsToMarkdown = (findings: AgentFinding[]): string =>
  [
    '| Rank | Property | Price | Size (sqm) | £/sqm | Service Charge | Ground Rent | Location | Key Strengths | Main Issues |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...findings.map((finding) =>
      [
        finding.rank,
        finding.property,
        finding.price,
        finding.size_sqm,
        finding.pounds_per_sqm,
        finding.service_charge,
        finding.ground_rent,
        finding.location,
        finding.key_strengths,
        finding.main_issues,
      ]
        .map((value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' '))
        .join(' | '),
    ),
  ]
    .map((line) => (line.startsWith('|') ? line : `| ${line} |`))
    .join('\n');

export default function App() {
  const [websites, setWebsites] = useState<string>('');
  const [areas, setAreas] = useState<string>('');
  const [criteria, setCriteria] = useState<string>('');
  const [updateFrequency, setUpdateFrequency] = useState<FrequencyOption>('Daily');
  const [hasUnsavedFrequencySelection, setHasUnsavedFrequencySelection] = useState<boolean>(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isAgentRunning, setIsAgentRunning] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [resultTable, setResultTable] = useState<string>('');

  const statusLabel = useMemo(
    () => (isAgentRunning ? 'Agent Running' : 'Agent Stopped'),
    [isAgentRunning],
  );

  const fetchAgentStatus = async (options?: { syncFrequencySelection?: boolean }) => {
    const shouldSyncFrequencySelection = options?.syncFrequencySelection ?? false;
    const response = await fetch(buildApiUrl('/property-agent/status'));
    if (!response.ok) {
      throw new Error('Failed to load property agent status');
    }

    const payload = (await response.json()) as {
      is_running: boolean;
      update_frequency_minutes: number | null;
      findings: AgentFinding[];
    };

    setIsAgentRunning(payload.is_running);

    if (payload.update_frequency_minutes !== null && !hasUnsavedFrequencySelection) {
      const frequencyMatch = Object.entries(frequencyToMinutes).find(
        ([_label, minutes]) => minutes === payload.update_frequency_minutes,
      );
      if (frequencyMatch) {
        setUpdateFrequency(frequencyMatch[0] as FrequencyOption);
      }
    } else if (payload.update_frequency_minutes !== null && shouldSyncFrequencySelection) {
      const frequencyMatch = Object.entries(frequencyToMinutes).find(
        ([_label, minutes]) => minutes === payload.update_frequency_minutes,
      );
      if (frequencyMatch) {
        setUpdateFrequency(frequencyMatch[0] as FrequencyOption);
      }
      setHasUnsavedFrequencySelection(false);
    }

    const hasFindings = payload.findings.length > 0;
    setResultTable(hasFindings ? findingsToMarkdown(payload.findings) : '');
  };

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

        await fetchAgentStatus({ syncFrequencySelection: true });
      } catch (error) {
        setStatusMessage(
          `Could not load saved configuration or agent status: ${(error as Error).message}`,
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
    let agentStarted = false;
    let latestResultTable = '';

    try {
      const response = await fetch(`${API_BASE_URL}/property-agent/set-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          websites_to_search: websites,
          areas_to_search: areas,
          property_criteria: criteria,
          update_frequency_minutes: Number(frequencyMinutes),
        }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json()) as { detail?: string };
        throw new Error(errorPayload.detail ?? 'Failed to create property search agent');
      }

      const payload = (await response.json()) as { table_markdown: string };
      agentStarted = true;
      latestResultTable = payload.table_markdown;

      const kvResponse = await fetch(`${API_BASE_URL}/kv/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: valuesByKey }),
      });

      if (!kvResponse.ok) {
        const errorPayload = (await kvResponse.json()) as { detail?: string };
        throw new Error(errorPayload.detail ?? 'Failed to persist search settings');
      }

      setIsAgentRunning(true);
      setHasUnsavedFrequencySelection(false);
      setStatusMessage(
        `Agent running. Searching every ${frequencyMinutes} minutes and sending updates via the configured notification channel.`,
      );
      setResultTable(latestResultTable);
    } catch (error) {
      setIsAgentRunning(agentStarted);
      setResultTable(agentStarted ? latestResultTable : '');
      setStatusMessage(
        agentStarted
          ? `Agent started, but failed to save search settings: ${(error as Error).message}`
          : `Failed to save search: ${(error as Error).message}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const onCancelAgent = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/property-agent/cancel`, { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to cancel property agent');
      }
      setIsAgentRunning(false);
      setResultTable('');
      setStatusMessage('Property agent cancelled. No further scheduled searches will run.');
    } catch (error) {
      setStatusMessage(`Failed to cancel property agent: ${(error as Error).message}`);
    }
  };

  useEffect(() => {
    const intervalId = setInterval(() => {
      void fetchAgentStatus().catch(() => {
        // Keep the most recent UI state if status polling fails transiently.
      });
    }, 15000);

    return () => clearInterval(intervalId);
  }, []);

  const onSelectFrequency = (option: FrequencyOption) => {
    setUpdateFrequency(option);
    setHasUnsavedFrequencySelection(true);
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
            <Pressable
              style={({ pressed }) => [
                styles.dropdownTrigger,
                pressed ? styles.pressablePressed : undefined,
              ]}
              onPress={() => setIsDropdownOpen((prev) => !prev)}
            >
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
                      style={({ pressed }) => [
                        styles.dropdownItem,
                        isSelected ? styles.dropdownItemSelected : undefined,
                        pressed ? styles.pressablePressed : undefined,
                      ]}
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
            style={({ pressed }) => [
              styles.primaryButton,
              isSaving ? styles.primaryButtonDisabled : undefined,
              pressed && !isSaving ? styles.pressablePressed : undefined,
            ]}
            onPress={() => void onStartAgent()}
            disabled={isSaving}
          >
            <Text style={styles.primaryButtonText}>
              {isSaving ? 'Saving...' : 'Set Property Agent Search'}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed ? styles.pressablePressed : undefined,
            ]}
            onPress={onCancelAgent}
          >
            <Text style={styles.secondaryButtonText}>Cancel Property Agent</Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, isAgentRunning ? styles.statusDotRunning : styles.statusDotStopped]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        {statusMessage ? <Text style={styles.statusMessage}>{statusMessage}</Text> : null}
        {resultTable ? (
          <View style={styles.resultsCard}>
            <Text style={styles.resultsTitle}>Latest Results (Top 10)</Text>
            <ScrollView horizontal>
              <Text style={styles.resultsTableText}>{resultTable}</Text>
            </ScrollView>
          </View>
        ) : null}
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
  pressablePressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.88,
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
  resultsCard: {
    marginTop: 20,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#161923',
  },
  resultsTableText: {
    fontSize: 12,
    color: '#222',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
