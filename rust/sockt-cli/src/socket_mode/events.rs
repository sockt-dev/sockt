use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackMessage {
    pub channel: String,
    pub user: String,
    pub text: String,
    pub ts: String,
    pub thread_ts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackInteraction {
    pub trigger_id: String,
    pub action_id: String,
    pub user: String,
    pub channel: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SlackEvent {
    #[serde(rename = "hello")]
    Hello { connection_info: ConnectionInfo },
    #[serde(rename = "events_api")]
    EventsApi {
        envelope_id: String,
        payload: EventPayload,
    },
    #[serde(rename = "interactive")]
    Interactive {
        envelope_id: String,
        payload: InteractionPayload,
    },
    #[serde(rename = "disconnect")]
    Disconnect { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub app_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPayload {
    pub event: MessageEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageEvent {
    pub channel: String,
    pub user: Option<String>,
    pub text: Option<String>,
    pub ts: String,
    pub thread_ts: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionPayload {
    pub trigger_id: String,
    pub actions: Vec<Action>,
    pub user: UserInfo,
    pub channel: ChannelInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub action_id: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Acknowledge {
    pub envelope_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Hello Event ─────────────────────────────────────────────────────

    #[test]
    fn parse_hello_event() {
        let json = r#"{"type":"hello","connection_info":{"app_id":"A123"}}"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::Hello { connection_info } => {
                assert_eq!(connection_info.app_id, "A123");
            }
            _ => panic!("expected Hello event"),
        }
    }

    #[test]
    fn parse_hello_with_long_app_id() {
        let json = r#"{"type":"hello","connection_info":{"app_id":"A0123456789ABCDEF"}}"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::Hello { connection_info } => {
                assert_eq!(connection_info.app_id, "A0123456789ABCDEF");
            }
            _ => panic!("expected Hello event"),
        }
    }

    // ─── Events API ──────────────────────────────────────────────────────

    #[test]
    fn parse_events_api() {
        let json = r#"{
            "type": "events_api",
            "envelope_id": "env-123",
            "payload": {
                "event": {
                    "channel": "C123",
                    "user": "U456",
                    "text": "hello bot",
                    "ts": "1234567890.123456",
                    "thread_ts": null
                }
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::EventsApi { envelope_id, payload } => {
                assert_eq!(envelope_id, "env-123");
                assert_eq!(payload.event.text.unwrap(), "hello bot");
                assert_eq!(payload.event.channel, "C123");
                assert_eq!(payload.event.user, Some("U456".to_string()));
            }
            _ => panic!("expected EventsApi event"),
        }
    }

    #[test]
    fn parse_events_api_with_thread() {
        let json = r#"{
            "type": "events_api",
            "envelope_id": "env-thread",
            "payload": {
                "event": {
                    "channel": "C789",
                    "user": "U111",
                    "text": "reply in thread",
                    "ts": "1234567890.100000",
                    "thread_ts": "1234567890.000001"
                }
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::EventsApi { payload, .. } => {
                assert_eq!(payload.event.thread_ts, Some("1234567890.000001".to_string()));
            }
            _ => panic!("expected EventsApi event"),
        }
    }

    #[test]
    fn parse_events_api_with_null_user() {
        let json = r#"{
            "type": "events_api",
            "envelope_id": "env-bot",
            "payload": {
                "event": {
                    "channel": "C123",
                    "user": null,
                    "text": "bot message",
                    "ts": "1234567890.123456",
                    "thread_ts": null
                }
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::EventsApi { payload, .. } => {
                assert!(payload.event.user.is_none());
            }
            _ => panic!("expected EventsApi event"),
        }
    }

    #[test]
    fn parse_events_api_with_null_text() {
        let json = r#"{
            "type": "events_api",
            "envelope_id": "env-no-text",
            "payload": {
                "event": {
                    "channel": "C123",
                    "user": "U456",
                    "text": null,
                    "ts": "1234567890.123456",
                    "thread_ts": null
                }
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::EventsApi { payload, .. } => {
                assert!(payload.event.text.is_none());
            }
            _ => panic!("expected EventsApi event"),
        }
    }

    // ─── Interactive Event ───────────────────────────────────────────────

    #[test]
    fn parse_interactive_event() {
        let json = r#"{
            "type": "interactive",
            "envelope_id": "env-int-1",
            "payload": {
                "trigger_id": "trig-123",
                "actions": [
                    {"action_id": "approve_btn", "value": "approved"}
                ],
                "user": {"id": "U789"},
                "channel": {"id": "C456"}
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::Interactive { envelope_id, payload } => {
                assert_eq!(envelope_id, "env-int-1");
                assert_eq!(payload.trigger_id, "trig-123");
                assert_eq!(payload.actions.len(), 1);
                assert_eq!(payload.actions[0].action_id, "approve_btn");
                assert_eq!(payload.actions[0].value, Some("approved".to_string()));
                assert_eq!(payload.user.id, "U789");
                assert_eq!(payload.channel.id, "C456");
            }
            _ => panic!("expected Interactive event"),
        }
    }

    #[test]
    fn parse_interactive_with_multiple_actions() {
        let json = r#"{
            "type": "interactive",
            "envelope_id": "env-multi",
            "payload": {
                "trigger_id": "trig-456",
                "actions": [
                    {"action_id": "btn1", "value": "v1"},
                    {"action_id": "btn2", "value": null},
                    {"action_id": "btn3", "value": "v3"}
                ],
                "user": {"id": "U1"},
                "channel": {"id": "C1"}
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::Interactive { payload, .. } => {
                assert_eq!(payload.actions.len(), 3);
                assert_eq!(payload.actions[1].value, None);
            }
            _ => panic!("expected Interactive event"),
        }
    }

    // ─── Disconnect Event ────────────────────────────────────────────────

    #[test]
    fn parse_disconnect_event() {
        let json = r#"{"type":"disconnect","reason":"link_disabled"}"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::Disconnect { reason } => {
                assert_eq!(reason, "link_disabled");
            }
            _ => panic!("expected Disconnect event"),
        }
    }

    #[test]
    fn parse_disconnect_various_reasons() {
        let reasons = ["link_disabled", "warning", "refresh_requested", "too_many_connections"];
        for reason in reasons {
            let json = format!(r#"{{"type":"disconnect","reason":"{}"}}"#, reason);
            let event: SlackEvent = serde_json::from_str(&json).unwrap();
            match event {
                SlackEvent::Disconnect { reason: r } => assert_eq!(r, reason),
                _ => panic!("expected Disconnect"),
            }
        }
    }

    // ─── Acknowledge ─────────────────────────────────────────────────────

    #[test]
    fn acknowledge_serialization() {
        let ack = Acknowledge {
            envelope_id: "env-456".to_string(),
        };
        let json = serde_json::to_string(&ack).unwrap();
        assert!(json.contains("env-456"));
        assert!(json.contains("envelope_id"));
    }

    #[test]
    fn acknowledge_roundtrip() {
        let ack = Acknowledge {
            envelope_id: "round-trip-id".to_string(),
        };
        let json = serde_json::to_string(&ack).unwrap();
        let parsed: Acknowledge = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.envelope_id, "round-trip-id");
    }

    // ─── Error Cases ─────────────────────────────────────────────────────

    #[test]
    fn invalid_json_returns_error() {
        let result = serde_json::from_str::<SlackEvent>("not json");
        assert!(result.is_err());
    }

    #[test]
    fn empty_string_returns_error() {
        let result = serde_json::from_str::<SlackEvent>("");
        assert!(result.is_err());
    }

    #[test]
    fn null_returns_error() {
        let result = serde_json::from_str::<SlackEvent>("null");
        assert!(result.is_err());
    }

    #[test]
    fn unknown_type_returns_error() {
        let json = r#"{"type":"unknown_event","data":"foo"}"#;
        let result = serde_json::from_str::<SlackEvent>(json);
        assert!(result.is_err());
    }

    #[test]
    fn missing_type_field_returns_error() {
        let json = r#"{"envelope_id":"env-1","payload":{}}"#;
        let result = serde_json::from_str::<SlackEvent>(json);
        assert!(result.is_err());
    }

    #[test]
    fn malformed_events_api_missing_payload_returns_error() {
        let json = r#"{"type":"events_api","envelope_id":"env-1"}"#;
        let result = serde_json::from_str::<SlackEvent>(json);
        assert!(result.is_err());
    }

    // ─── Unicode & Edge Cases ────────────────────────────────────────────

    #[test]
    fn events_api_with_unicode_text() {
        let json = r#"{
            "type": "events_api",
            "envelope_id": "env-unicode",
            "payload": {
                "event": {
                    "channel": "C123",
                    "user": "U456",
                    "text": "こんにちは 🤖 مرحبا",
                    "ts": "1234567890.123456",
                    "thread_ts": null
                }
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::EventsApi { payload, .. } => {
                assert_eq!(payload.event.text.unwrap(), "こんにちは 🤖 مرحبا");
            }
            _ => panic!("expected EventsApi"),
        }
    }

    #[test]
    fn events_api_with_empty_text() {
        let json = r#"{
            "type": "events_api",
            "envelope_id": "env-empty",
            "payload": {
                "event": {
                    "channel": "C123",
                    "user": "U456",
                    "text": "",
                    "ts": "1234567890.123456",
                    "thread_ts": null
                }
            }
        }"#;
        let event: SlackEvent = serde_json::from_str(json).unwrap();
        match event {
            SlackEvent::EventsApi { payload, .. } => {
                assert_eq!(payload.event.text.unwrap(), "");
            }
            _ => panic!("expected EventsApi"),
        }
    }

    #[test]
    fn slack_message_struct_roundtrip() {
        let msg = SlackMessage {
            channel: "C123".to_string(),
            user: "U456".to_string(),
            text: "test message".to_string(),
            ts: "123.456".to_string(),
            thread_ts: Some("123.001".to_string()),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: SlackMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.channel, "C123");
        assert_eq!(parsed.thread_ts, Some("123.001".to_string()));
    }

    #[test]
    fn slack_interaction_struct_roundtrip() {
        let inter = SlackInteraction {
            trigger_id: "trig".to_string(),
            action_id: "act".to_string(),
            user: "U1".to_string(),
            channel: "C1".to_string(),
            value: Some("val".to_string()),
        };
        let json = serde_json::to_string(&inter).unwrap();
        let parsed: SlackInteraction = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.trigger_id, "trig");
        assert_eq!(parsed.value, Some("val".to_string()));
    }
}
