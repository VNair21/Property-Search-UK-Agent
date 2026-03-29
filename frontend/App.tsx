import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import { Button, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export default function App() {
  const [health, setHealth] = useState<string>('Not checked');
  const [key, setKey] = useState<string>('sample');
  const [value, setValue] = useState<string>('hello-redis');
  const [fetched, setFetched] = useState<string>('');

  const healthUrl = useMemo(() => `${API_BASE_URL}/health`, []);

  const checkHealth = async () => {
    try {
      const res = await fetch(healthUrl);
      const data = await res.json();
      setHealth(JSON.stringify(data));
    } catch (error) {
      setHealth(`Error: ${(error as Error).message}`);
    }
  };

  const writeValue = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/kv/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      setFetched(`Saved: ${JSON.stringify(data)}`);
    } catch (error) {
      setFetched(`Write error: ${(error as Error).message}`);
    }
  };

  const readValue = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/kv/${encodeURIComponent(key)}`);
      const data = await res.json();
      setFetched(`Read: ${JSON.stringify(data)}`);
    } catch (error) {
      setFetched(`Read error: ${(error as Error).message}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>React Native + FastAPI + Redis Starter</Text>
        <Text style={styles.caption}>API Base URL: {API_BASE_URL}</Text>

        <View style={styles.section}>
          <Text style={styles.subtitle}>Health Check</Text>
          <Button title="Check /health" onPress={checkHealth} />
          <Text style={styles.output}>{health}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.subtitle}>Redis Key/Value</Text>
          <TextInput style={styles.input} value={key} onChangeText={setKey} placeholder="Key" />
          <TextInput style={styles.input} value={value} onChangeText={setValue} placeholder="Value" />
          <View style={styles.row}>
            <Button title="Write" onPress={writeValue} />
            <View style={styles.spacer} />
            <Button title="Read" onPress={readValue} />
          </View>
          <Text style={styles.output}>{fetched}</Text>
        </View>
      </ScrollView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  caption: { color: '#555' },
  section: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  spacer: { width: 12 },
  output: { color: '#1f2937' },
});
