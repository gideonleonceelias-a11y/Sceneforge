const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { test, before, after, beforeEach } = require("node:test");
const fs = require("node:fs");

let testEnv;
const PROJECT_ID = process.env.GCP_PROJECT || "demo-no-project";
const ALICE_UID = "alice_writer_123";
const BOB_UID = "bob_director_456";

const [emulatorHost, emulatorPortStr] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085").split(":");
const emulatorPort = parseInt(emulatorPortStr, 10);

function validCharacterPayload(uid, nowOffsetMs = 1000) {
  const ts = new Date(Date.now() - nowOffsetMs);
  return {
    userId: uid,
    name: "Elena Vance",
    role: "Protagonist",
    archetype: "Reluctant Whistleblower",
    ageOrLook: "30s, sharp blazer, sleepless eyes",
    coreDesire: "Deliver the encrypted drive before midnight.",
    fatalFlaw: "Refuses to trust even her closest ally.",
    backstory: "Lost her brother in the same corporate cover-up.",
    voiceStyle: "Clipped, precise, speaks in tense subtext.",
    accentColorKey: "AMBER",
    createdAt: ts,
    updatedAt: ts,
  };
}

function validScriptPayload(uid, nowOffsetMs = 1000) {
  const ts = new Date(Date.now() - nowOffsetMs);
  return {
    userId: uid,
    title: "The Last Train Car",
    genre: "Thriller",
    logline: "Two estranged siblings have 90 seconds before the train crosses the border.",
    setting: "INT. SUBWAY CAR - 2:14 AM",
    tone: "Claustrophobic, taut",
    targetDurationSec: 90,
    characterIds: ["char_elena"],
    characterNames: ["Elena Vance"],
    beats: [
      {
        beatTitle: "The Standoff",
        beatType: "HOOK",
        cameraCue: "ECU on Elena's trembling hand",
        summary: "Elena grips the briefcase as the doors lock.",
      },
    ],
    lines: [
      {
        lineType: "ACTION",
        speaker: "",
        parenthetical: "",
        text: "Fluorescent lights flicker overhead as the train lurches forward.",
        emotionCue: "Tense",
      },
      {
        lineType: "DIALOGUE",
        speaker: "ELENA",
        parenthetical: "under her breath",
        text: "You shouldn't have followed me onto this car.",
        emotionCue: "Guarded",
      },
    ],
    directorNotes: "Keep handheld close-ups tight on the eyes.",
    status: "DRAFT",
    createdAt: ts,
    updatedAt: ts,
  };
}

before(async () => {
  const rules = fs.readFileSync("./firestore.rules", "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: emulatorHost,
      port: emulatorPort,
    },
  });
});

after(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

test("Unauthenticated user cannot read or write characters or scripts", async () => {
  const unauthDb = testEnv.unauthenticatedContext().firestore();
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("characters").get());
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("characters").doc("c1").set(validCharacterPayload(ALICE_UID))
  );
  await assertFails(unauthDb.collection("users").doc(ALICE_UID).collection("scripts").get());
  await assertFails(
    unauthDb.collection("users").doc(ALICE_UID).collection("scripts").doc("s1").set(validScriptPayload(ALICE_UID))
  );
});

test("Owner can create, list, partially update, and delete character profiles", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const charRef = aliceDb.collection("users").doc(ALICE_UID).collection("characters").doc("char_1");

  await assertSucceeds(charRef.set(validCharacterPayload(ALICE_UID, 5000)));
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("characters").get());

  await assertSucceeds(
    charRef.update({
      fatalFlaw: "Overestimates her leverage in high-pressure negotiations.",
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Reject immutable createdAt modification
  await assertFails(
    charRef.update({
      createdAt: new Date(Date.now() - 500),
      updatedAt: new Date(Date.now() - 500),
    })
  );

  // Reject ghost field
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("characters").doc("char_ghost").set({
      ...validCharacterPayload(ALICE_UID, 5000),
      isAdmin: true,
    })
  );

  // Reject @DocumentId `id` field
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("characters").doc("char_with_id").set({
      id: "char_with_id",
      ...validCharacterPayload(ALICE_UID, 5000),
    })
  );

  // Reject invalid accentColorKey
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("characters").doc("char_bad_color").set({
      ...validCharacterPayload(ALICE_UID, 5000),
      accentColorKey: "NEON_PINK",
    })
  );

  await assertSucceeds(charRef.delete());
});

test("Owner can create, list, update, and delete scripts", async () => {
  const aliceDb = testEnv.authenticatedContext(ALICE_UID).firestore();
  const scriptRef = aliceDb.collection("users").doc(ALICE_UID).collection("scripts").doc("script_1");

  await assertSucceeds(scriptRef.set(validScriptPayload(ALICE_UID, 5000)));
  await assertSucceeds(aliceDb.collection("users").doc(ALICE_UID).collection("scripts").get());

  await assertSucceeds(
    scriptRef.update({
      status: "REFINED",
      directorNotes: "Add rain sound design before beat 2.",
      updatedAt: new Date(Date.now() - 1000),
    })
  );

  // Reject invalid status
  await assertFails(
    scriptRef.update({
      status: "PUBLISHED",
      updatedAt: new Date(Date.now() - 500),
    })
  );

  // Reject future timestamp
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("scripts").doc("script_future").set({
      ...validScriptPayload(ALICE_UID, -60000),
    })
  );

  // Reject invalid duration bounds
  await assertFails(
    aliceDb.collection("users").doc(ALICE_UID).collection("scripts").doc("script_short").set({
      ...validScriptPayload(ALICE_UID, 5000),
      targetDurationSec: 5,
    })
  );

  await assertSucceeds(scriptRef.delete());
});

test("Cross-user isolation prevents Bob from reading or modifying Alice's characters or scripts", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await adminDb.collection("users").doc(ALICE_UID).collection("characters").doc("c_alice").set(validCharacterPayload(ALICE_UID, 5000));
    await adminDb.collection("users").doc(ALICE_UID).collection("scripts").doc("s_alice").set(validScriptPayload(ALICE_UID, 5000));
  });

  const bobDb = testEnv.authenticatedContext(BOB_UID).firestore();
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("characters").get());
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("characters").doc("c_alice").get());
  await assertFails(
    bobDb.collection("users").doc(ALICE_UID).collection("characters").doc("c_alice").update({
      name: "Hijacked",
      updatedAt: new Date(Date.now() - 1000),
    })
  );
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("scripts").get());
  await assertFails(bobDb.collection("users").doc(ALICE_UID).collection("scripts").doc("s_alice").delete());
});
