// Custom entry: expo-router plus the Android widget task handler, which must
// be registered at start-up so the headless widget task finds it.
import "expo-router/entry";
import "./widgets/register";
