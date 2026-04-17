import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';

interface RecordParams {
  mode: 'add' | 'edit' | 'view';
  id?: number;
  title?: string;
  content?: string;
}

export default function RecordScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<RecordParams>();
  const [title, setTitle] = useState(params.title || '');
  const [content, setContent] = useState(params.content || '');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isViewMode = params.mode === 'view';
  const isEditMode = params.mode === 'edit';
  const isAddMode = params.mode === 'add';

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      Alert.alert('提示', '请输入标题');
      return;
    }
    if (!content.trim()) {
      Alert.alert('提示', '请输入内容');
      return;
    }

    setIsSaving(true);
    try {
      let response;
      if (isAddMode) {
        // Create new record
        response = await fetch(`${API_BASE}/api/v1/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        });
      } else if (isEditMode && params.id) {
        // Update existing record
        response = await fetch(`${API_BASE}/api/v1/records/${params.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        });
      }

      const result = await response?.json();
      if (result?.code === 0) {
        Alert.alert('成功', isAddMode ? '记录已保存' : '记录已更新', [
          { text: '确定', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('错误', result?.message || '保存失败');
      }
    } catch (error) {
      console.error('Save error:', error);
      Alert.alert('错误', '网络请求失败');
    } finally {
      setIsSaving(false);
    }
  }, [title, content, isAddMode, isEditMode, params.id, router]);

  const handleDelete = useCallback(() => {
    if (!params.id) return;

    Alert.alert('确认删除', '确定要删除这条记录吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          setIsLoading(true);
          try {
            const response = await fetch(`${API_BASE}/api/v1/records/${params.id}`, {
              method: 'DELETE',
            });
            const result = await response.json();
            if (result.code === 0) {
              Alert.alert('成功', '记录已删除', [
                { text: '确定', onPress: () => router.back() },
              ]);
            } else {
              Alert.alert('错误', result.message || '删除失败');
            }
          } catch (error) {
            console.error('Delete error:', error);
            Alert.alert('错误', '网络请求失败');
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  }, [params.id, router]);

  const handleEdit = useCallback(() => {
    router.replace('/record', { mode: 'edit', id: params.id, title, content });
  }, [router, params.id, title, content]);

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={24} color="#2D3436" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isAddMode ? '新建记录' : isEditMode ? '编辑记录' : '查看记录'}
          </Text>
          <View style={styles.headerRight}>
            {isViewMode && (
              <>
                <TouchableOpacity
                  style={styles.headerButton}
                  onPress={handleEdit}
                  activeOpacity={0.7}
                >
                  <Feather name="edit-2" size={20} color="#6C63FF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.headerButton}
                  onPress={handleDelete}
                  activeOpacity={0.7}
                >
                  <Feather name="trash-2" size={20} color="#FF6B6B" />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Form */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>标题</Text>
            {isViewMode ? (
              <View style={styles.viewField}>
                <Text style={styles.viewText}>{title || '无标题'}</Text>
              </View>
            ) : (
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="输入标题..."
                  placeholderTextColor="#B2BEC3"
                  value={title}
                  onChangeText={setTitle}
                  maxLength={100}
                />
              </View>
            )}
          </View>

          {/* Content Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>内容</Text>
            {isViewMode ? (
              <View style={styles.viewField}>
                <Text style={styles.viewText}>{content || '无内容'}</Text>
              </View>
            ) : (
              <View style={[styles.inputContainer, styles.textAreaContainer]}>
                <TextInput
                  style={styles.textArea}
                  placeholder="输入内容..."
                  placeholderTextColor="#B2BEC3"
                  value={content}
                  onChangeText={setContent}
                  multiline
                  textAlignVertical="top"
                />
              </View>
            )}
          </View>

          {/* Tips */}
          {isAddMode && (
            <View style={styles.tipsContainer}>
              <Feather name="info" size={16} color="#6C63FF" />
              <Text style={styles.tipsText}>
                记录会自动存入向量数据库，支持语义搜索
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Save Button */}
        {!isViewMode && (
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={isSaving}
            >
              <LinearGradient
                colors={['#6C63FF', '#896BFF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.saveButtonGradient}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>
                    {isAddMode ? '保存记录' : '保存修改'}
                  </Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#D1D9E6',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 0.6,
        shadowRadius: 6,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2D3436',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#D1D9E6',
        shadowOffset: { width: 4, height: 4 },
        shadowOpacity: 0.6,
        shadowRadius: 6,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 100,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2D3436',
    marginBottom: 12,
  },
  inputContainer: {
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  input: {
    fontSize: 15,
    color: '#2D3436',
  },
  textAreaContainer: {
    minHeight: 200,
  },
  textArea: {
    fontSize: 15,
    color: '#2D3436',
    minHeight: 180,
  },
  viewField: {
    backgroundColor: '#E8E8EB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  viewText: {
    fontSize: 15,
    color: '#2D3436',
    lineHeight: 22,
  },
  tipsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(108,99,255,0.08)',
    borderRadius: 12,
    padding: 12,
  },
  tipsText: {
    flex: 1,
    fontSize: 13,
    color: '#6C63FF',
    marginLeft: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 32,
    paddingTop: 16,
    backgroundColor: '#F0F0F3',
  },
  saveButton: {
    borderRadius: 9999,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#6C63FF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  saveButtonGradient: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
