import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Feather } from '@expo/vector-icons';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';

interface RecordItem {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export default function HomeScreen() {
  const router = useSafeRouter();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchRecords = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/v1/records`);
      const result = await response.json();
      if (result.code === 0) {
        setRecords(result.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch records:', error);
    }
  }, []);

  const searchRecords = useCallback(async (query: string) => {
    if (!query.trim()) {
      fetchRecords();
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/records/search?q=${encodeURIComponent(query)}`);
      const result = await response.json();
      if (result.code === 0) {
        setRecords(result.data || []);
      }
    } catch (error) {
      console.error('Failed to search records:', error);
    } finally {
      setIsSearching(false);
    }
  }, [fetchRecords]);

  useFocusEffect(
    useCallback(() => {
      fetchRecords();
    }, [fetchRecords])
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchRecords();
    setIsRefreshing(false);
  }, [fetchRecords]);

  const handleSearch = useCallback(() => {
    searchRecords(searchQuery);
  }, [searchQuery, searchRecords]);

  const handleAddRecord = useCallback(() => {
    router.push('/record', { mode: 'add' });
  }, [router]);

  const handleRecordPress = useCallback((record: RecordItem) => {
    router.push('/record', { mode: 'view', id: record.id, title: record.title, content: record.content });
  }, [router]);

  const handleChatPress = useCallback(() => {
    router.push('/chat');
  }, [router]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const renderItem = ({ item }: { item: RecordItem }) => (
    <TouchableOpacity
      style={styles.cardOuter}
      onPress={() => handleRecordPress(item)}
      activeOpacity={0.9}
    >
      <View style={styles.card}>
        <View style={styles.cardContent}>
          <View style={styles.iconContainer}>
            <Feather name="file-text" size={20} color="#6C63FF" />
          </View>
          <View style={styles.textContainer}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.cardDescription} numberOfLines={2}>
              {item.content}
            </Text>
            <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
          </View>
          <Feather name="chevron-right" size={20} color="#B2BEC3" />
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Feather name="inbox" size={64} color="#B2BEC3" />
      <Text style={styles.emptyTitle}>暂无记录</Text>
      <Text style={styles.emptyDescription}>点击下方按钮开始记录你的想法</Text>
    </View>
  );

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.pageTitle}>个人助手</Text>
            <Text style={styles.pageSubtitle}>记录你的每一个想法</Text>
          </View>
          <TouchableOpacity
            style={styles.aiButton}
            onPress={handleChatPress}
            activeOpacity={0.8}
          >
            <Feather name="message-circle" size={20} color="#6C63FF" />
            <Text style={styles.aiButtonText}>AI 助手</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Feather name="search" size={18} color="#B2BEC3" />
            <TextInput
              style={styles.searchInput}
              placeholder="搜索记录..."
              placeholderTextColor="#B2BEC3"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchQuery.length > 0 ? (
              <View style={styles.searchActions}>
                <TouchableOpacity onPress={handleSearch} style={styles.searchActionButton}>
                  <Text style={styles.searchActionText}>搜索</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  setSearchQuery('');
                  fetchRecords();
                }}>
                  <Feather name="x" size={18} color="#B2BEC3" />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {/* Records List */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6C63FF" />
          </View>
        ) : (
          <FlatList
            data={records}
            renderItem={renderItem}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={renderEmpty}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor="#6C63FF"
              />
            }
          />
        )}

        {/* FAB */}
        <TouchableOpacity
          style={styles.fab}
          onPress={handleAddRecord}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={28} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Loading Overlay for Search */}
        {isSearching && (
          <View style={styles.searchOverlay}>
            <ActivityIndicator size="small" color="#6C63FF" />
            <Text style={styles.searchText}>搜索中...</Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F0F3',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flex: 1,
  },
  aiButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(108,99,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  aiButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C63FF',
    marginLeft: 6,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2D3436',
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#636E72',
    marginTop: 4,
  },
  searchContainer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#2D3436',
    marginLeft: 10,
  },
  searchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#6C63FF',
    borderRadius: 12,
  },
  searchActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 120,
  },
  cardOuter: {
    marginBottom: 16,
    borderRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#D1D9E6',
        shadowOffset: { width: 6, height: 6 },
        shadowOpacity: 0.7,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  card: {
    backgroundColor: '#F0F0F3',
    borderRadius: 24,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(108,99,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
    marginLeft: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#2D3436',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#636E72',
    lineHeight: 18,
  },
  cardDate: {
    fontSize: 12,
    color: '#B2BEC3',
    marginTop: 6,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
    marginTop: 16,
  },
  emptyDescription: {
    fontSize: 14,
    color: '#636E72',
    marginTop: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#6C63FF',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#6C63FF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  searchOverlay: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  searchText: {
    fontSize: 14,
    color: '#636E72',
    marginLeft: 8,
  },
});
