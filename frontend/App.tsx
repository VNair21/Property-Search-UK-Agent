import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
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
  listing_url: string;
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
const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

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
const minutesToFrequencyLabel = (minutes: number | null): FrequencyOption | null => {
  if (minutes === null) {
    return null;
  }

  const frequencyMatch = Object.entries(frequencyToMinutes).find(
    ([_label, optionMinutes]) => optionMinutes === minutes,
  );

  return frequencyMatch ? (frequencyMatch[0] as FrequencyOption) : null;
};

const tableColumns: Array<{ key: keyof AgentFinding; label: string; width: number }> = [
  { key: 'rank', label: 'Rank', width: 70 },
  { key: 'property', label: 'Property', width: 240 },
  { key: 'price', label: 'Price', width: 120 },
  { key: 'size_sqm', label: 'Size (sqm)', width: 110 },
  { key: 'pounds_per_sqm', label: '£/sqm', width: 100 },
  { key: 'service_charge', label: 'Service Charge', width: 140 },
  { key: 'ground_rent', label: 'Ground Rent', width: 130 },
  { key: 'location', label: 'Location', width: 160 },
  { key: 'key_strengths', label: 'Key Strengths', width: 240 },
  { key: 'main_issues', label: 'Main Issues', width: 240 },
  { key: 'listing_url', label: 'Live Listing', width: 280 },
];

export default function App() {
  const [websites, setWebsites] = useState<string>('');
  const [areas, setAreas] = useState<string>('');
  const [criteria, setCriteria] = useState<string>('');
  const [updateFrequency, setUpdateFrequency] = useState<FrequencyOption>('Daily');
  const [hasUnsavedFrequencySelection, setHasUnsavedFrequencySelection] = useState<boolean>(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isAgentRunning, setIsAgentRunning] = useState<boolean>(false);
  const [hideCachedFindings, setHideCachedFindings] = useState<boolean>(false);
  const [agentUpdateFrequency, setAgentUpdateFrequency] = useState<FrequencyOption | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [resultFindings, setResultFindings] = useState<AgentFinding[]>([]);

  const statusLabel = useMemo(
    () => (isAgentRunning ? 'Agent Running' : 'Agent Stopped'),
    [isAgentRunning],
  );

  const handleListingPress = async (rawListingUrl: string): Promise<void> => {
    const listingUrl = rawListingUrl.trim();
    if (!listingUrl || !isHttpUrl(listingUrl)) {
      setStatusMessage('Unable to open listing: invalid URL format.');
      return;
    }

    try {
      const canOpenUrl = await Linking.canOpenURL(listingUrl);
      if (!canOpenUrl) {
        setStatusMessage('Unable to open listing: unsupported URL.');
        return;
      }

      await Linking.openURL(listingUrl);
    } catch (_error) {
      setStatusMessage('Unable to open listing right now. Please try again.');
    }
  };

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
    if (payload.is_running) {
      setHideCachedFindings(false);
    }
    setAgentUpdateFrequency(minutesToFrequencyLabel(payload.update_frequency_minutes));

    if (payload.update_frequency_minutes !== null && !hasUnsavedFrequencySelection) {
      const frequencyMatch = minutesToFrequencyLabel(payload.update_frequency_minutes);
      if (frequencyMatch) {
        setUpdateFrequency(frequencyMatch);
      }
    } else if (payload.update_frequency_minutes !== null && shouldSyncFrequencySelection) {
      const frequencyMatch = minutesToFrequencyLabel(payload.update_frequency_minutes);
      if (frequencyMatch) {
        setUpdateFrequency(frequencyMatch);
      }
      setHasUnsavedFrequencySelection(false);
    }

    const hasFindings = payload.findings.length > 0;
    const shouldShowFindings = hasFindings && !hideCachedFindings;
    setResultFindings(shouldShowFindings ? payload.findings : []);
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
    let latestResultFindings: AgentFinding[] = [];

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

      const payload = (await response.json()) as { findings: AgentFinding[] };
      agentStarted = true;
      latestResultFindings = payload.findings;

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
      setHideCachedFindings(false);
      setAgentUpdateFrequency(updateFrequency);
      setHasUnsavedFrequencySelection(false);
      setStatusMessage(
        `Agent running. Searching every ${frequencyMinutes} minutes and sending updates via the configured notification channel.`,
      );
      setResultFindings(latestResultFindings);
    } catch (error) {
      setIsAgentRunning(agentStarted);
      setResultFindings(agentStarted ? latestResultFindings : []);
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
      setHideCachedFindings(true);
      setResultFindings([]);
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
        {isAgentRunning && agentUpdateFrequency ? (
          <Text style={styles.frequencyStatusText}>
            Running with {agentUpdateFrequency.toLowerCase()} updates.
          </Text>
        ) : null}
        {statusMessage ? <Text style={styles.statusMessage}>{statusMessage}</Text> : null}
        {resultFindings.length > 0 ? (
          <View style={styles.resultsCard}>
            <Text style={styles.resultsTitle}>Latest Results (Top 10)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={styles.tableHeaderRow}>
                  {tableColumns.map((column) => (
                    <Text
                      key={`header-${column.key}`}
                      style={[styles.tableHeaderCell, { width: column.width }]}
                    >
                      {column.label}
                    </Text>
                  ))}
                </View>
                {resultFindings.map((finding, rowIndex) => (
                  <View
                    key={`${finding.rank}-${finding.property}-${rowIndex}`}
                    style={[styles.tableBodyRow, rowIndex % 2 === 0 ? styles.tableRowAlt : undefined]}
                  >
                    {tableColumns.map((column) =>
                      column.key === 'listing_url' ? (
                        <Pressable
                          key={`${rowIndex}-${column.key}`}
                          onPress={() => {
                            void handleListingPress(finding.listing_url);
                          }}
                        >
                          <Text style={[styles.tableBodyCell, styles.linkCell, { width: column.width }]}>
                            {finding.listing_url}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text key={`${rowIndex}-${column.key}`} style={[styles.tableBodyCell, { width: column.width }]}>
                          {String(finding[column.key])}
                        </Text>
                      ),
                    )}
                  </View>
                ))}
              </View>
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
  frequencyStatusText: {
    marginTop: 8,
    fontSize: 14,
    color: '#515765',
    textAlign: 'center',
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
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f3f9',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  tableHeaderCell: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#232838',
    borderBottomWidth: 1,
    borderBottomColor: '#dfe3ee',
  },
  tableBodyRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eceff6',
  },
  tableRowAlt: {
    backgroundColor: '#fafbfe',
  },
  tableBodyCell: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 12,
    lineHeight: 16,
    color: '#2d3446',
  },
  linkCell: {
    color: '#2f6dfc',
    textDecorationLine: 'underline',
  },
});
