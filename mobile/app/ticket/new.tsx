import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  findNodeHandle,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { PhotoMarkupEditor } from "@/components/photo-markup-editor";
import { PhishingReportSheet } from "@/components/phishing-report-sheet";
import { PortalAssistantSheet } from "@/components/portal-assistant-sheet";
import { RequesterPicker } from "@/components/requester-picker";
import { ScreenContainer } from "@/components/screen-container";
import {
  ClassificationSuggestionButton,
  TicketSuggestionList,
  useMobileTicketSuggestions,
} from "@/components/ticket-suggestions";
import { useMobileNetworkStatus } from "@/components/offline-status";
import {
  hapticError,
  hapticSelection,
  hapticSuccess,
} from "@/lib/mobile-haptics";
import {
  clearLocalTicketDraft,
  loadLocalTicketDraft,
  saveLocalTicketDraft,
} from "@/lib/mobile-private-state";
import { uploadPickedPhoto } from "@/lib/mobile-ticket-attachments";
import { linkMobileTicketAsset } from "@/lib/asset-registry";
import { linkedAssetFromParams } from "@/lib/asset-qr";
import {
  loadPortalAssistantEnabled,
  recordAssistantOutcome,
} from "@/lib/nextdesk-assistance";
import type { AssistantDraft } from "@/lib/portal-assistant";
import { loadPhishingConfig, type PhishingConfig } from "@/lib/phishing-report";
import {
  resolveSuggestionMode,
  type SuggestionMode,
} from "@/lib/mobile-ticket-suggestions";
import {
  getMobileUserId,
  loadCurrentTenant,
  type MobileTenant,
} from "@/lib/nextdesk-client";
import {
  createMobileTicket,
  loadTicketFormOptions,
  type TicketRequester,
  type TicketFormOptions,
} from "@/lib/nextdesk-tickets";
import { makeThemedStyles, useAppColors } from "@/lib/themed-styles";
import { tn } from "@/lib/formality";

const NEW_TICKET_DRAFT_ID = "new-ticket";
const MAX_NEW_TICKET_PHOTOS = 5;

export default function NewTicketScreen() {
  // Vorbelegung, z. B. aus einem gescannten Gerät.
  const params = useLocalSearchParams<{
    assetId?: string;
    assetName?: string;
    description?: string;
    subject?: string;
    // «Ticket für … erfassen» in the person overview.
    requesterId?: string;
    requesterName?: string;
  }>();
  // Gerät aus dem Scanner bzw. der Asset-Ansicht: wird mit dem Ticket verknüpft.
  const [linkedAsset, setLinkedAsset] = useState(() =>
    linkedAssetFromParams(params),
  );
  const [initialPrefill] = useState(() => ({
    requester:
      typeof params.requesterId === "string" &&
      typeof params.requesterName === "string" &&
      params.requesterId &&
      params.requesterName
        ? { id: params.requesterId, displayName: params.requesterName }
        : null,
    description:
      typeof params.description === "string" ? params.description : "",
    subject: typeof params.subject === "string" ? params.subject : "",
  }));
  const { isOffline } = useMobileNetworkStatus();
  const [tenant, setTenant] = useState<MobileTenant | null>(null);
  const [options, setOptions] = useState<TicketFormOptions | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [priorityKey, setPriorityKey] = useState("");
  const [requester, setRequester] = useState<TicketRequester | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  // Index of the photo being marked up («Markieren»).
  const [markupIndex, setMarkupIndex] = useState<number | null>(null);
  // «Selbstbedienungs-Assistent» (optional per tenant, off by default).
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantResult, setAssistantResult] = useState<{
    sessionId: string;
    departmentId: string;
    categoryId: string | null;
    categoryName: string | null;
  } | null>(null);
  // «Phishing melden» (only when the tenant set it up).
  const [phishing, setPhishing] = useState<PhishingConfig | null>(null);
  const [phishingOpen, setPhishingOpen] = useState(false);
  const draftReady = useRef(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const subjectInputRef = useRef<TextInput>(null);
  const descriptionInputRef = useRef<TextInput>(null);
  const styles = useStyles();
  const colors = useAppColors();

  useEffect(() => {
    if (isOffline) return;
    void (async () => {
      try {
        const currentTenant = await loadCurrentTenant();
        const formOptions = await loadTicketFormOptions(currentTenant.id);
        setTenant(currentTenant);
        setOptions(formOptions);
        void loadPortalAssistantEnabled(currentTenant.id).then(
          setAssistantEnabled,
        );
        void loadPhishingConfig(currentTenant.id).then(setPhishing);
        setDepartmentId(formOptions.departments[0]?.id ?? "");
        setPriorityKey(formOptions.priorities[0]?.key ?? "");
        setRequester(initialPrefill.requester ?? formOptions.currentRequester);
        if (initialPrefill.subject || initialPrefill.description) {
          setSubject(initialPrefill.subject);
          setDescription(initialPrefill.description);
        } else {
          // Ein zuvor begonnener Entwurf wird wiederhergestellt.
          try {
            const userId = await getMobileUserId();
            const draft = await loadLocalTicketDraft({
              userId,
              tenantId: currentTenant.id,
              ticketId: NEW_TICKET_DRAFT_ID,
              visibility: "internal",
            });
            if (draft) {
              const parsed: unknown = JSON.parse(draft.body);
              if (typeof parsed === "object" && parsed !== null) {
                const record = parsed as Record<string, unknown>;
                if (typeof record.subject === "string")
                  setSubject(record.subject);
                if (typeof record.description === "string")
                  setDescription(record.description);
              }
            }
          } catch {
            // Ohne lesbaren Entwurf startet das Formular leer.
          }
        }
        draftReady.current = true;
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Die Erfassung konnte nicht vorbereitet werden.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [initialPrefill, isOffline]);

  useEffect(() => {
    // Android may end nextDesk while the camera app or photo picker is open
    // (low memory). The pick is then delivered on the next start and would be
    // lost without this call.
    if (Platform.OS !== "android") return;
    let active = true;
    void ImagePicker.getPendingResultAsync()
      .then((result) => {
        if (!active || !result || !("assets" in result)) return;
        if (result.canceled || !result.assets?.length) return;
        const images = result.assets.filter(
          (asset) => !asset.type || asset.type === "image",
        );
        setPhotos((current) =>
          [...current, ...images].slice(0, MAX_NEW_TICKET_PHOTOS),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const selectedDepartment = useMemo(
    () =>
      options?.departments.find(
        (department) => department.id === departmentId,
      ) ?? null,
    [departmentId, options],
  );
  const selectedRequester = requester ?? options?.currentRequester ?? null;
  const photosFull = photos.length >= MAX_NEW_TICKET_PHOTOS;
  // Offered to people who create a ticket for themselves.
  const showAssistant =
    assistantEnabled &&
    Boolean(tenant) &&
    (!selectedRequester ||
      selectedRequester.id === options?.currentRequester?.id);
  const assistantCategory =
    assistantResult && assistantResult.departmentId === departmentId
      ? assistantResult
      : null;

  function applyAssistantDraft(draft: AssistantDraft, sessionId: string) {
    setSubject(draft.subject);
    setDescription(draft.description);
    setAssistantResult({
      sessionId,
      departmentId,
      categoryId: draft.categoryId,
      categoryName: draft.categoryName,
    });
    setAssistantOpen(false);
  }

  // Entwurf automatisch sichern, damit eine Unterbrechung nichts kostet.
  useEffect(() => {
    if (!draftReady.current || !tenant) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const userId = await getMobileUserId();
          await saveLocalTicketDraft({
            userId,
            tenantId: tenant.id,
            ticketId: NEW_TICKET_DRAFT_ID,
            visibility: "internal",
            body:
              subject.trim() || description.trim()
                ? JSON.stringify({ subject, description })
                : "",
          });
        } catch {
          // Der Entwurf ist eine Komfortfunktion und darf nie stören.
        }
      })();
    }, 700);
    return () => clearTimeout(timer);
  }, [description, subject, tenant]);

  // Agent suggestions when the person may assign agents in the department,
  // as in the web composer; the server falls back to the requester view.
  const [resolvedMode, setResolvedMode] = useState<{
    key: string;
    mode: SuggestionMode;
  } | null>(null);
  const modeKey = tenant && departmentId ? `${tenant.id}:${departmentId}` : "";
  useEffect(() => {
    if (!tenant || !departmentId || isOffline) return;
    let active = true;
    const key = `${tenant.id}:${departmentId}`;
    void resolveSuggestionMode(tenant.id, departmentId).then((mode) => {
      if (active) setResolvedMode({ key, mode });
    });
    return () => {
      active = false;
    };
  }, [departmentId, isOffline, tenant]);
  const suggestionMode: SuggestionMode =
    modeKey && resolvedMode?.key === modeKey ? resolvedMode.mode : "requester";
  const suggestions = useMobileTicketSuggestions({
    description,
    enabled: !loading && !saving && !isOffline && options !== null,
    mode: suggestionMode,
    subject,
    tenantId: tenant?.id ?? null,
  });
  const classification =
    suggestions?.mode === "agent" ? suggestions.classification : null;
  const departmentSuggestion =
    classification?.department &&
    classification.department.id !== departmentId &&
    options?.departments.some(
      (department) => department.id === classification.department?.id,
    )
      ? classification.department
      : null;
  const prioritySuggestion =
    classification?.priority &&
    classification.priority.key !== priorityKey &&
    options?.priorities.some(
      (priority) => priority.key === classification.priority?.key,
    )
      ? classification.priority
      : null;

  if (isOffline) {
    return (
      <ScreenContainer className="px-5">
        <View style={styles.offlineGuard}>
          <View style={styles.offlineGuardIcon}>
            <Ionicons
              color={colors.warning}
              name="cloud-offline-outline"
              size={25}
            />
          </View>
          <Text style={styles.offlineGuardTitle}>
            Ticketerfassung benötigt eine Verbindung
          </Text>
          <Text style={styles.offlineGuardText}>
            Neue Tickets werden ausschliesslich nach einer serverseitigen
            Mandanten- und Rechteprüfung erfasst.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.offlineGuardButton}
          >
            <Text style={styles.offlineGuardButtonText}>Zurück zu Tickets</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  function revealFieldAboveKeyboard(input: TextInput | null) {
    const inputHandle = findNodeHandle(input);
    const scrollResponder = scrollViewRef.current?.getScrollResponder();
    if (!inputHandle || !scrollResponder) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        scrollResponder.scrollResponderScrollNativeHandleToKeyboard(
          inputHandle,
          88,
          true,
        );
      }, 120);
    });
  }

  function explainBlockedCamera() {
    // The system dialog is not shown again after a permanent refusal. The
    // choice is respected; only a way to change it is offered, and photos
    // from the media library keep working without camera access.
    Alert.alert(
      "Kamerazugriff ist ausgeschaltet",
      tn(
        "Du kannst den Kamerazugriff für nextDesk in den Einstellungen erlauben oder stattdessen ein Bild aus der Mediathek wählen.",
        "Sie können den Kamerazugriff für nextDesk in den Einstellungen erlauben oder stattdessen ein Bild aus der Mediathek wählen.",
      ),
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Einstellungen öffnen",
          onPress: () => void Linking.openSettings().catch(() => undefined),
        },
      ],
    );
  }

  async function addPhoto(source: "camera" | "library") {
    const remaining = MAX_NEW_TICKET_PHOTOS - photos.length;
    if (remaining <= 0) return;
    hapticSelection();
    setError("");
    try {
      if (source === "camera") {
        // Asked only now, when the person wants to take a photo, never in
        // advance (Apple HIG «Privacy», Android «Request permissions»).
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          if (!permission.canAskAgain) {
            explainBlockedCamera();
            return;
          }
          setError(
            tn(
              "Ohne Kamerazugriff kannst du kein Foto aufnehmen. Du kannst stattdessen ein Bild aus der Mediathek wählen.",
              "Ohne Kamerazugriff können Sie kein Foto aufnehmen. Sie können stattdessen ein Bild aus der Mediathek wählen.",
            ),
          );
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          allowsEditing: false,
          cameraType: ImagePicker.CameraType.back,
          exif: false,
          mediaTypes: ["images"],
          quality: 1,
        });
        if (!result.canceled) {
          setPhotos((current) =>
            [...current, ...result.assets].slice(0, MAX_NEW_TICKET_PHOTOS),
          );
        }
        return;
      }
      // System photo picker (PHPicker on iOS, Android Photo Picker): it runs
      // outside the app, needs no library permission and hands over only the
      // selected images (Apple 5.1.1(iii), Google Play photo and video
      // permissions policy).
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        allowsMultipleSelection: remaining > 1,
        exif: false,
        mediaTypes: ["images"],
        orderedSelection: true,
        quality: 1,
        selectionLimit: remaining,
      });
      if (!result.canceled) {
        setPhotos((current) =>
          [...current, ...result.assets].slice(0, MAX_NEW_TICKET_PHOTOS),
        );
      }
    } catch {
      hapticError();
      setError(
        source === "camera"
          ? "Die Kamera konnte nicht geöffnet werden. Möglicherweise hat dieses Gerät keine Kamera."
          : "Die Mediathek konnte nicht geöffnet werden.",
      );
    }
  }

  async function finishWithArticle() {
    // "Hat mein Problem gelöst": no ticket is created, the draft is cleared.
    if (tenant) {
      try {
        await clearLocalTicketDraft({
          userId: await getMobileUserId(),
          tenantId: tenant.id,
          ticketId: NEW_TICKET_DRAFT_ID,
        });
      } catch {
        // Ein übrig gebliebener Entwurf wird beim nächsten Speichern ersetzt.
      }
    }
    hapticSuccess();
    router.back();
    Alert.alert(
      "Schön, dass es geklappt hat",
      tn(
        "Es wurde kein Ticket erstellt. Danke für deine Rückmeldung.",
        "Es wurde kein Ticket erstellt. Danke für Ihre Rückmeldung.",
      ),
    );
  }

  async function createTicket() {
    if (isOffline) {
      hapticError();
      setError(
        "Tickets können erst wieder erfasst werden, wenn eine Verbindung zum autorisierten Server besteht.",
      );
      return;
    }
    if (!tenant || !options) return;
    const cleanSubject = subject.trim();
    const cleanDescription = description.trim();
    if (cleanSubject.length < 3) {
      hapticError();
      setError(tn("Bitte gib einen Betreff mit mindestens 3 Zeichen ein.", "Bitte geben Sie einen Betreff mit mindestens 3 Zeichen ein."));
      return;
    }
    if (!departmentId || !priorityKey) {
      hapticError();
      setError(
        tn(
          "Bitte wähle Abteilung und Priorität.",
          "Bitte wählen Sie Abteilung und Priorität.",
        ),
      );
      return;
    }
    if (!selectedRequester) {
      hapticError();
      setError(
        tn(
          "Bitte wähle eine anfragende Person.",
          "Bitte wählen Sie eine anfragende Person.",
        ),
      );
      return;
    }
    setSaving(true);
    setError("");
    try {
      const ticket = await createMobileTicket({
        tenantId: tenant.id,
        departmentId,
        priorityKey,
        requesterContactId: selectedRequester.id,
        subject: cleanSubject,
        // Die Beschreibung ist optional; ohne sie dient der Betreff als Text.
        description: cleanDescription || cleanSubject,
        categoryId: assistantCategory?.categoryId ?? null,
      });
      if (linkedAsset) {
        // Best effort: ohne Recht «ticket.update» bleibt das Gerät in der
        // Beschreibung erwähnt, die Verknüpfung fehlt dann.
        await linkMobileTicketAsset(
          tenant.id,
          ticket.ticketId,
          linkedAsset.id,
        ).catch(() => undefined);
      }
      if (assistantResult) {
        void recordAssistantOutcome({
          tenantId: tenant.id,
          sessionId: assistantResult.sessionId,
          outcome: "ticket_created",
          ticketId: ticket.ticketId,
        });
      }
      let failedPhotos = 0;
      for (const [index, photo] of photos.entries()) {
        try {
          await uploadPickedPhoto({
            height: photo.height,
            index,
            tenantId: tenant.id,
            ticketId: ticket.ticketId,
            uri: photo.uri,
            width: photo.width,
          });
        } catch {
          failedPhotos += 1;
        }
      }
      try {
        await clearLocalTicketDraft({
          userId: await getMobileUserId(),
          tenantId: tenant.id,
          ticketId: NEW_TICKET_DRAFT_ID,
        });
      } catch {
        // Ein übrig gebliebener Entwurf wird beim nächsten Speichern ersetzt.
      }
      router.replace({
        pathname: "/ticket/[id]",
        params: { id: ticket.ticketId },
      });
      hapticSuccess();
      if (failedPhotos > 0) {
        Alert.alert(
          "Fotos nicht hochgeladen",
          tn(
            `${failedPhotos} Foto${failedPhotos === 1 ? "" : "s"} konnte${failedPhotos === 1 ? "" : "n"} nicht hochgeladen werden. Du kannst sie im Ticket erneut hinzufügen.`,
            `${failedPhotos} Foto${failedPhotos === 1 ? "" : "s"} konnte${failedPhotos === 1 ? "" : "n"} nicht hochgeladen werden. Sie können sie im Ticket erneut hinzufügen.`,
          ),
        );
      }
    } catch (nextError) {
      hapticError();
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Das Ticket konnte nicht erfasst werden.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenContainer className="px-5">
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Zurück zur Übersicht"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Ionicons color={colors.primaryText} name="arrow-back" size={22} />
          </Pressable>
          <Text style={styles.topTitle}>Ticket erfassen</Text>
          <View style={styles.topSpacer} />
        </View>

        <View style={styles.intro}>
          <Text style={styles.title}>
            {tn("Was können wir für dich tun?", "Was können wir für Sie tun?")}
          </Text>
          <Text style={styles.copy}>
            {tn(
              <>
                Dein Ticket wird direkt im Mandanten{" "}
                {tenant?.name ?? "nextDesk"} erfasst.
              </>,
              <>
                Ihr Ticket wird direkt im Mandanten {tenant?.name ?? "nextDesk"}{" "}
                erfasst.
              </>,
            )}
          </Text>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.copy}>Formular wird geladen …</Text>
          </View>
        ) : options ? (
          <View style={styles.form}>
            {showAssistant && tenant ? (
              <>
                <Pressable
                  accessibilityHint={tn(
                    "Beschreibe dein Problem in einem kurzen Chat",
                    "Beschreiben Sie Ihr Problem in einem kurzen Chat",
                  )}
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => {
                    hapticSelection();
                    setAssistantOpen(true);
                  }}
                  style={styles.assistantButton}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="sparkles-outline"
                    size={20}
                  />
                  <View style={styles.assistantCopy}>
                    <Text style={styles.assistantTitle}>
                      Mit dem Assistenten lösen
                    </Text>
                    <Text style={styles.hint}>
                      {assistantResult
                        ? "Entwurf übernommen – prüfe ihn und erfasse das Ticket."
                        : tn(
                            "Vielleicht gibt es schon eine Anleitung für dein Problem.",
                            "Vielleicht gibt es schon eine Anleitung für Ihr Problem.",
                          )}
                    </Text>
                  </View>
                </Pressable>
                <PortalAssistantSheet
                  departmentId={departmentId || null}
                  onClose={() => setAssistantOpen(false)}
                  onOpenArticle={(articleId) => {
                    setAssistantOpen(false);
                    router.push(`/knowledge/${articleId}` as never);
                  }}
                  onSolved={() => {
                    setAssistantOpen(false);
                    void finishWithArticle();
                  }}
                  onUseDraft={applyAssistantDraft}
                  tenantId={tenant.id}
                  visible={assistantOpen}
                />
              </>
            ) : null}
            {phishing?.enabled && tenant ? (
              <>
                <Pressable
                  accessibilityHint="Verdächtige E-Mail an das Sicherheitsteam melden"
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => {
                    hapticSelection();
                    setPhishingOpen(true);
                  }}
                  style={styles.assistantButton}
                >
                  <Ionicons
                    color={colors.primaryText}
                    name="shield-outline"
                    size={20}
                  />
                  <View style={styles.assistantCopy}>
                    <Text style={styles.assistantTitle}>Phishing melden</Text>
                    <Text style={styles.hint}>
                      {tn(
                        "Verdächtige E-Mail? Füge die Kopfzeilen ein – wir prüfen sie für dich.",
                        "Verdächtige E-Mail? Fügen Sie die Kopfzeilen ein – wir prüfen sie für Sie.",
                      )}
                    </Text>
                  </View>
                </Pressable>
                <PhishingReportSheet
                  onClose={() => setPhishingOpen(false)}
                  onOpenTicket={(ticketId) =>
                    router.replace({
                      pathname: "/ticket/[id]",
                      params: { id: ticketId },
                    })
                  }
                  reportAddress={phishing.reportAddress}
                  tenantId={tenant.id}
                  visible={phishingOpen}
                />
              </>
            ) : null}
            <FieldLabel label="ANFRAGENDE PERSON" />
            <RequesterPicker
              defaultRequester={options.currentRequester}
              onChange={setRequester}
              tenantId={tenant?.id ?? ""}
              value={selectedRequester}
            />

            <FieldLabel label="BETREFF" />
            <TextInput
              autoCapitalize="sentences"
              maxLength={240}
              onChangeText={setSubject}
              onFocus={() => revealFieldAboveKeyboard(subjectInputRef.current)}
              placeholder="z. B. VPN-Zugang für Homeoffice"
              placeholderTextColor={colors.subtle}
              ref={subjectInputRef}
              style={styles.input}
              value={subject}
            />

            <FieldLabel label="BESCHREIBUNG (OPTIONAL)" />
            <TextInput
              autoCapitalize="sentences"
              multiline
              onChangeText={setDescription}
              onFocus={() =>
                revealFieldAboveKeyboard(descriptionInputRef.current)
              }
              placeholder={tn(
                "Beschreibe dein Anliegen möglichst genau.",
                "Beschreiben Sie Ihr Anliegen möglichst genau.",
              )}
              placeholderTextColor={colors.subtle}
              ref={descriptionInputRef}
              style={[styles.input, styles.descriptionInput]}
              textAlignVertical="top"
              value={description}
            />

            {tenant ? (
              <TicketSuggestionList
                disabled={saving}
                onDeflected={() => void finishWithArticle()}
                onOpenArticle={(articleId) =>
                  router.push(`/knowledge/${articleId}` as never)
                }
                onOpenTicket={(ticketId) =>
                  router.push({
                    pathname: "/ticket/[id]",
                    params: { id: ticketId },
                  })
                }
                subject={subject}
                suggestions={suggestions}
                tenantId={tenant.id}
              />
            ) : null}

            {linkedAsset ? (
              <>
                <FieldLabel label="BETROFFENES GERÄT" />
                <View style={styles.assetChip}>
                  <Ionicons
                    color={colors.primaryText}
                    name="laptop-outline"
                    size={18}
                  />
                  <Text numberOfLines={1} style={styles.assetChipText}>
                    {linkedAsset.name}
                  </Text>
                  <Pressable
                    accessibilityLabel="Gerät nicht verknüpfen"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setLinkedAsset(null)}
                  >
                    <Ionicons
                      color={colors.primaryText}
                      name="close-circle"
                      size={20}
                    />
                  </Pressable>
                </View>
              </>
            ) : null}

            <FieldLabel label="FOTOS (OPTIONAL)" />
            <View style={styles.photoActions}>
              <Pressable
                accessibilityHint="Öffnet die Kamera, um ein Foto direkt aufzunehmen."
                accessibilityLabel="Foto mit der Kamera aufnehmen"
                accessibilityRole="button"
                accessibilityState={{ disabled: photosFull }}
                disabled={photosFull}
                onPress={() => void addPhoto("camera")}
                style={({ pressed }) => [
                  styles.photoButton,
                  pressed && styles.photoButtonPressed,
                  photosFull && styles.photoButtonDisabled,
                ]}
              >
                <Ionicons
                  color={colors.primaryText}
                  name="camera-outline"
                  size={20}
                />
                <Text style={styles.photoButtonText}>Foto aufnehmen</Text>
              </Pressable>
              <Pressable
                accessibilityHint={tn(
                  `Wähle bis zu ${MAX_NEW_TICKET_PHOTOS} Bilder aus deiner Mediathek.`,
                  `Wählen Sie bis zu ${MAX_NEW_TICKET_PHOTOS} Bilder aus Ihrer Mediathek.`,
                )}
                accessibilityLabel="Fotos aus der Mediathek auswählen"
                accessibilityRole="button"
                accessibilityState={{ disabled: photosFull }}
                disabled={photosFull}
                onPress={() => void addPhoto("library")}
                style={({ pressed }) => [
                  styles.photoButton,
                  pressed && styles.photoButtonPressed,
                  photosFull && styles.photoButtonDisabled,
                ]}
              >
                <Ionicons
                  color={colors.primaryText}
                  name="images-outline"
                  size={20}
                />
                <Text style={styles.photoButtonText}>Aus Mediathek</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {photosFull
                ? `Maximal ${MAX_NEW_TICKET_PHOTOS} Fotos pro Ticket erreicht. Weitere ${tn("kannst du", "können Sie")} im Ticket ergänzen.`
                : `${photos.length} von ${MAX_NEW_TICKET_PHOTOS} Fotos. Standortdaten werden vor dem Hochladen entfernt.`}
            </Text>
            {photos.length > 0 ? (
              <View style={styles.photoRow}>
                {photos.map((photo, index) => (
                  <View key={`${photo.uri}-${index}`} style={styles.photoThumb}>
                    <Image
                      accessibilityLabel={`Foto ${index + 1}`}
                      contentFit="cover"
                      source={{ uri: photo.uri }}
                      style={styles.photoImage}
                    />
                    <Pressable
                      accessibilityLabel={`Foto ${index + 1} markieren`}
                      accessibilityRole="button"
                      hitSlop={6}
                      onPress={() => {
                        hapticSelection();
                        setMarkupIndex(index);
                      }}
                      style={styles.photoMarkup}
                    >
                      <Ionicons color="#ffffff" name="brush" size={12} />
                      <Text style={styles.photoMarkupText}>Markieren</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Foto ${index + 1} entfernen`}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() =>
                        setPhotos((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                      style={styles.photoRemove}
                    >
                      <Ionicons color="#ffffff" name="close" size={14} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            <PhotoMarkupEditor
              onCancel={() => setMarkupIndex(null)}
              onSave={(result) => {
                const index = markupIndex;
                setMarkupIndex(null);
                if (index === null) return;
                // Das markierte Bild ersetzt das Original als Anhang.
                setPhotos((current) =>
                  current.map((photo, position) =>
                    position === index
                      ? {
                          ...photo,
                          uri: result.uri,
                          width: result.width,
                          height: result.height,
                        }
                      : photo,
                  ),
                );
              }}
              photo={
                markupIndex === null ? null : (photos[markupIndex] ?? null)
              }
            />

            <FieldLabel label="ABTEILUNG" />
            <View style={styles.choiceList}>
              {options.departments.map((department) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: department.id === departmentId,
                  }}
                  key={department.id}
                  onPress={() => {
                    hapticSelection();
                    setDepartmentId(department.id);
                  }}
                  style={[
                    styles.choice,
                    department.id === departmentId && styles.choiceActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      department.id === departmentId && styles.choiceTextActive,
                    ]}
                  >
                    {department.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            {selectedDepartment ? (
              <Text style={styles.hint}>
                Bearbeitende Abteilung: {selectedDepartment.name}
              </Text>
            ) : null}
            {assistantCategory?.categoryName ? (
              <Text style={styles.hint}>
                Kategorie vom Assistenten: {assistantCategory.categoryName}
              </Text>
            ) : null}
            {departmentSuggestion ? (
              <ClassificationSuggestionButton
                disabled={saving}
                onApply={() => setDepartmentId(departmentSuggestion.id)}
                vote={departmentSuggestion}
              />
            ) : null}

            <FieldLabel label="PRIORITÄT" />
            <View style={styles.choiceList}>
              {options.priorities.map((priority) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: priority.key === priorityKey,
                  }}
                  key={priority.key}
                  onPress={() => {
                    hapticSelection();
                    setPriorityKey(priority.key);
                  }}
                  style={[
                    styles.choice,
                    priority.key === priorityKey && styles.choiceActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      priority.key === priorityKey && styles.choiceTextActive,
                    ]}
                  >
                    {priority.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {prioritySuggestion ? (
              <ClassificationSuggestionButton
                disabled={saving}
                onApply={() => setPriorityKey(prioritySuggestion.key)}
                vote={prioritySuggestion}
              />
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={loading || saving || !options}
          onPress={() => void createTicket()}
          style={[
            styles.primaryButton,
            (loading || saving || !options) && styles.disabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Ionicons
              color={colors.onPrimary}
              name="add-circle-outline"
              size={20}
            />
          )}
          <Text style={styles.primaryButtonText}>
            {saving ? "Ticket wird erfasst …" : "Ticket erfassen"}
          </Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

function FieldLabel({ label }: { label: string }) {
  const styles = useStyles();
  return <Text style={styles.label}>{label}</Text>;
}

const useStyles = makeThemedStyles((c) => ({
  assistantButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  assistantCopy: { flex: 1, gap: 2 },
  assistantTitle: { color: c.primaryText, fontSize: 15, fontWeight: "800" },
  photoActions: { flexDirection: "row", gap: 10 },
  photoButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 12,
  },
  photoButtonText: { color: c.primaryText, fontSize: 13, fontWeight: "800" },
  photoButtonPressed: { opacity: 0.75 },
  photoButtonDisabled: { opacity: 0.45 },
  photoImage: { borderRadius: 12, height: "100%", width: "100%" },
  photoRemove: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 11,
    height: 22,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    top: 4,
    width: 22,
  },
  photoMarkup: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 9,
    bottom: 4,
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    left: 4,
    paddingVertical: 3,
    position: "absolute",
    right: 4,
  },
  photoMarkupText: { color: "#ffffff", fontSize: 10, fontWeight: "800" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoThumb: { height: 88, width: 88 },
  assetChip: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderColor: c.primarySoftBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  assetChipText: {
    color: c.primaryText,
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
  },
  content: { gap: 16, paddingTop: 14, paddingBottom: 320 },
  offlineGuard: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  offlineGuardIcon: {
    alignItems: "center",
    backgroundColor: c.warningSoft,
    borderRadius: 20,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  offlineGuardTitle: {
    color: c.foreground,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 16,
    textAlign: "center",
  },
  offlineGuardText: {
    color: c.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    textAlign: "center",
  },
  offlineGuardButton: {
    backgroundColor: c.primarySoft,
    borderRadius: 14,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  offlineGuardButtonText: {
    color: c.primaryText,
    fontSize: 13,
    fontWeight: "900",
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  backButton: {
    alignItems: "center",
    backgroundColor: c.primarySoft,
    borderRadius: 18,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  topTitle: { color: c.foreground, fontSize: 17, fontWeight: "800" },
  topSpacer: { width: 40 },
  intro: { gap: 8, paddingTop: 10 },
  title: {
    color: c.foreground,
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 33,
  },
  copy: { color: c.muted, fontSize: 15, lineHeight: 23 },
  centered: { alignItems: "center", gap: 10, paddingVertical: 35 },
  form: {
    backgroundColor: c.surface,
    borderColor: c.surfaceSubtle,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 17,
  },
  label: {
    color: c.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
    marginTop: 7,
  },
  input: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 13,
    borderWidth: 1,
    color: c.foreground,
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  descriptionInput: { minHeight: 126 },
  choiceList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    backgroundColor: c.surfaceSubtle,
    borderColor: c.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  choiceActive: {
    backgroundColor: c.primarySoft,
    borderColor: c.primaryText,
  },
  choiceText: { color: c.muted, fontSize: 13, fontWeight: "700" },
  choiceTextActive: { color: c.primaryText },
  hint: { color: c.muted, fontSize: 12, lineHeight: 18 },
  error: { color: c.error, fontSize: 13, lineHeight: 19 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: c.primary,
    borderRadius: 16,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: c.onPrimary, fontSize: 15, fontWeight: "800" },
  disabled: { opacity: 0.55 },
}));
