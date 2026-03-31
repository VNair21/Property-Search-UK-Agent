import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import {
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

export default function App() {
  const [websites, setWebsites] = useState<string>('');
  const [areas, setAreas] = useState<string>('');
  const [criteria, setCriteria] = useState<string>('');
  const [updateFrequency, setUpdateFrequency] = useState<FrequencyOption>('Daily');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isAgentRunning, setIsAgentRunning] = useState<boolean>(true);

  const statusLabel = useMemo(
    () => (isAgentRunning ? 'Agent Running' : 'Agent Stopped'),
    [isAgentRunning],
  );

  const onStartAgent = () => {
    setIsAgentRunning(true);
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
          <Pressable style={styles.primaryButton} onPress={onStartAgent}>
            <Text style={styles.primaryButtonText}>Set Property Agent Search</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onCancelAgent}>
            <Text style={styles.secondaryButtonText}>Cancel Property Agent</Text>
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, isAgentRunning ? styles.statusDotRunning : styles.statusDotStopped]} />
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
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
    fontSize: 18 / 2 * 2,
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
    fontSize: 20 / 2 * 2,
    color: '#38404f',
    fontWeight: '500',
  },
});
