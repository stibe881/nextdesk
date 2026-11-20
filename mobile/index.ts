// Custom entry: expo-router plus the Android widget task handler and the
// badge push task, which must be registered at start-up so the headless
// tasks find them.
import "expo-router/entry";
import "./widgets/register";
import "./lib/badge-push";
