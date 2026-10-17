import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";

export default function AuthCallbackScreen() {
  return (
    <ScreenContainer containerClassName="bg-[#F6F7FB]" className="px-5">
      <View style={styles.content}>
        <ActivityIndicator color="#4438CA" size="large" />
        <Text style={styles.message}>Anmeldung wird abgeschlossen …</Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: "center", flex: 1, gap: 16, justifyContent: "center" },
  message: {
    color: "#4B4C60",
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
});
