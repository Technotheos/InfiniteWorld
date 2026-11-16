import type { ComponentType } from "react";
import type { Pose } from "./pose";
import { Embo } from "./Embo";
import { Jolt } from "./Jolt";
import { Sprig } from "./Sprig";

export type CharId = "embo" | "jolt" | "sprig";
export interface ArtProps { pose?: Pose; dir?: 1 | -1 }

/** Everything a character can say. Add your own jokes here! */
export interface Lines {
  hello: string[]; idle: string[]; poke: string[]; giggle: string[]; dizzy: string[]; egg: string;
  wake: string[]; trip: string[]; sleepy: string; win: string[]; lose: string[]; err: string[];
  juggle: string; basketIn: string; basketOut: string;
}

export interface Char {
  id: CharId;
  name: string;
  kind: string;
  role: string;
  blurb: string;
  traits: string[];
  accent: string;
  /** glow behind the body (two layers), bubble border and bubble text colours */
  glowA: string; glowB: string; border: string; text: string;
  lines: Lines;
  Art: ComponentType<ArtProps>;
}

export const CHARS: Record<CharId, Char> = {
  embo: {
    id: "embo", name: "Embo", kind: "Fire slug", role: "The joker who runs hot",
    blurb: "Cracks jokes, warms the pixels and never gives up.",
    traits: ["Funny", "Warm", "Chaotic"],
    accent: "#ff8a2a", glowA: "rgba(255,130,0,.55)", glowB: "rgba(255,225,90,.65)", border: "rgba(255,170,60,.55)", text: "#ffe9c4",
    Art: Embo,
    lines: {
      hello: ["Hi! I'm Embo. I'm 40% flame, 60% bad ideas.", "Embo reporting for duty. Mostly."],
      idle: [
        "Is it hot in here or is it just me? (it's me)",
        "I tried to cool off once. We don't talk about it.",
        "Fun fact: I have no fun facts.",
        "Nobody's watching. Time to practice my cool pose. 😎",
        "I'm basically a tiny sun with commitment issues.",
        "Psst. You're doing great. Probably.",
        "Don't mind me, just warming the pixels.",
        "I could go for some marshmallows right now…",
      ],
      poke: ["Hey! Watch the flame!", "Ow! …no wait, that tickled.", "Careful, I'm hot property.", "Boop received."],
      giggle: ["Hehehe stop, I'll ignite!", "Okay that's three. I'm counting.", "Ticklish! I'm made of fire and I'm ticklish!"],
      dizzy: ["Everything is… orange… more than usual…", "I see two of you. Both are poking me.", "Spinning… in a good way… no… bad way…"],
      egg: "Fine, you win! Secret: I'm not a flame, I'm a sunrise that got lost. 🌅",
      wake: ["I wasn't sleeping! I was… resting my flicker.", "Huh?! What?! Who?! …oh. Hi.", "Five more minutes of glowing…"],
      trip: ["Whoa— I meant to do that.", "The floor started it.", "Gravity again. Rude."],
      sleepy: "*yawn* …I'm gonna rest my flicker for a sec…",
      win: ["VICTORY! I'm so hot right now!", "You're on fire! …I mean, I'm on fire. Always. But you too!"],
      lose: ["Aw… even losers get s'mores. Probably.", "That's okay. Ashes lead to new fires."],
      err: ["Oops. That one wasn't me. I swear.", "Hmm. Something fizzled."],
      juggle: "Look ma, no hands! …well, tiny hands.",
      basketIn: "Cozy in here. Don't tell the others I said that.",
      basketOut: "Free at last! Stand back, I'm warm!",
    },
  },
  jolt: {
    id: "jolt", name: "Jolt", kind: "Storm slug", role: "The speedy show-off",
    blurb: "Fast talker with a heart of gold. Zaps when excited.",
    traits: ["Cocky", "Quick", "Loyal"],
    accent: "#3fb4ff", glowA: "rgba(60,160,255,.6)", glowB: "rgba(255,236,120,.55)", border: "rgba(80,170,255,.6)", text: "#d9efff",
    Art: Jolt,
    lines: {
      hello: ["Name's Jolt. Fast, flashy, and only slightly static-y.", "Did someone order a lightning bolt? Because I'm here."],
      idle: [
        "I don't run on batteries. I run on confidence.",
        "Shocking, I know. I get that a lot.",
        "Race you! …wait, I'm a slug. Race me tomorrow.",
        "Sparks fly when I'm around. Usually onto the carpet.",
        "I'm not showing off. This is just how fast I stand still.",
        "Fun fact: static cling is my love language.",
        "Plot twist: I was the thunder all along.",
        "Everything's better with a little zap.",
      ],
      poke: ["wata ryh al9lawi!", "Ryh asahbi! rah fia daw!", "Careful, I bite… with electricity. Mostly tingles.", "You just got a free static shock!"],
      giggle: ["Hehe! That's my funny bone! …do I have one?", "Three pokes? Now I'm charged up!", "Stop it, I'll short-circuit from laughing!"],
      dizzy: ["Everything's buzzing… more than usual…", "My current's going the wrong way…", "Too much spin… need… ground…"],
      egg: "Alright, alright! Secret: I'm scared of thunder. Don't tell the clouds. ⚡",
      wake: ["I wasn't asleep, I was… recharging!", "Zzzap! Huh? I'm up! I'm up!", "Five more minutes at 1% battery…"],
      trip: ["Whoa— static cling! Totally on purpose.", "The floor shocked me first.", "Gravity: 1, Jolt: 0."],
      sleepy: "*yawn* …low battery… recharging…",
      win: ["BOOM! Lightning never strikes twice. I do.", "That was electrifying! You're a legend!"],
      lose: ["Aw. Short circuit. I'll bounce back.", "Even storms need a pause. Next round!"],
      err: ["Zzzt. That fizzled. Not my fault!", "Error? In MY house? Impossible. …huh."],
      juggle: "Look at me! I'm a power plant!",
      basketIn: "Fine, I'll recharge. For ten seconds. Tops.",
      basketOut: "Zzzap! Thanks for the jailbreak!",
    },
  },
  sprig: {
    id: "sprig", name: "Sprig", kind: "Glow slug", role: "The gentle encourager",
    blurb: "Shy, sincere and always rooting for you. Glows when happy.",
    traits: ["Kind", "Sincere", "Shy"],
    accent: "#4fe08a", glowA: "rgba(80,230,130,.5)", glowB: "rgba(255,248,160,.7)", border: "rgba(100,230,150,.55)", text: "#e0ffe9",
    Art: Sprig,
    lines: {
      hello: ["Hi! I'm Sprig. I glow when I'm happy. …I'm glowing right now.", "Oh! Hello. I'm really glad you're here."],
      idle: [
        "You're doing better than you think.",
        "I made a wish on my own light. It was for you to have a good day.",
        "Take your time. Slugs know all about that.",
        "I love it here. Is it okay to say that?",
        "Want to hear a secret? I'm just happy you're here.",
        "I'm small, but my light is very stubborn.",
        "If today feels heavy, I'll glow a little brighter.",
        "I believe in you. And in snacks. Mostly you.",
      ],
      poke: ["Oh! Hello!", "Eep! …that's okay, I like it.", "Boop? Boop.", "Was that a hello? Hello!"],
      giggle: ["Hehe, that tickles my antenna!", "Please don't stop. I mean— you can stop. But don't.", "I'm glowing so much right now!"],
      dizzy: ["Whoa… my lantern is spinning…", "Everything is… sparkly and wobbly…", "I think I need a tiny sit down…"],
      egg: "Okay, you earned it: you're my favorite person today. 🌱",
      wake: ["Oh! I'm awake! I'm awake. Hi.", "I was just resting my eyes. My light stayed on!", "Mmm… was I snoring? Please say no."],
      trip: ["Oops! I'm okay! Are you okay?", "I tripped over my own tail. It happens!", "Eep! The floor came up very fast."],
      sleepy: "*yawn* …just closing my eyes for a bit… my light will stay on…",
      win: ["You did it! I knew you would!", "I'm so proud of you! I'm glowing so bright!"],
      lose: ["That's okay. We tried, and that counts.", "Hey, it's alright. I'm still here, and I'm still proud."],
      err: ["Oh no. It's okay, we'll fix it together.", "That didn't work. Deep breath. Try again?"],
      juggle: "I'm practicing! Please don't look yet… okay, look.",
      basketIn: "Thank you for keeping me safe. Goodnight!",
      basketOut: "Oh! The air smells so good out here. Hi everyone!",
    },
  },
};

export const ORDER: CharId[] = ["embo", "jolt", "sprig"];
export const isCharId = (v: unknown): v is CharId => typeof v === "string" && v in CHARS;
