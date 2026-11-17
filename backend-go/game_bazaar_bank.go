package main

// Content for the Brain Bazaar room. Everything here is checked-by-hand general
// knowledge, and every item carries a short explanation that is shown after the
// round, because the point of the room is to learn something even when you lose.

// estimateQ: guess a number. Span is the "yardstick" for the error: a guess within
// 5% of Span is a bullseye, so years use a span of ~100 and quantities use the answer.
type estimateQ struct {
	Q       string
	Unit    string
	Answer  float64
	Span    float64
	Explain string
}

var estimateBank = []estimateQ{
	{"How tall is Mount Everest?", "m", 8849, 8849, "Its height was re-measured in 2020 by Nepal and China: 8,848.86 m above sea level."},
	{"How far is the Moon from Earth on average?", "km", 384400, 384400, "About 384,400 km. Light needs roughly 1.3 seconds to make the trip."},
	{"How many bones does an adult human have?", "", 206, 206, "Babies are born with around 300 that fuse together as they grow, leaving 206."},
	{"In what year did the Wright brothers make their first powered flight?", "", 1903, 100, "December 17, 1903, at Kitty Hawk. The first flight lasted 12 seconds."},
	{"How fast does light travel in a vacuum?", "km/s", 299792, 299792, "About 299,792 km per second. It is a constant of nature and nothing with mass can reach it."},
	{"How tall is the Eiffel Tower, antennas included?", "m", 330, 330, "It is about 330 m tall. It was the tallest man-made structure in the world until 1930."},
	{"How many countries are members of the United Nations?", "", 193, 193, "193 member states. The Holy See and Palestine are permanent observers."},
	{"How long is the Nile?", "km", 6650, 6650, "Around 6,650 km, which makes it one of the two longest rivers on Earth."},
	{"How deep is the Challenger Deep, the deepest known point of the ocean?", "m", 10935, 10935, "Roughly 10,935 m, deeper than Everest is tall. Pressure there is over 1,000 times that at the surface."},
	{"In what year was the University of al-Qarawiyyin in Fez founded?", "", 859, 150, "Founded in 859 by Fatima al-Fihri. It is often cited as the oldest continuously operating university."},
	{"How far is the Earth from the Sun on average?", "million km", 149.6, 149.6, "About 149.6 million km, which scientists call one astronomical unit (AU)."},
	{"How old is the universe?", "billion years", 13.8, 13.8, "Around 13.8 billion years, measured from the cosmic microwave background."},
	{"How many keys does a standard piano have?", "", 88, 88, "52 white keys and 36 black keys make 88."},
	{"How high is Toubkal, the highest peak in Morocco?", "m", 4167, 4167, "Toubkal in the High Atlas rises to 4,167 m, the highest summit in North Africa."},
	{"What is the surface temperature of the Sun?", "degrees C", 5500, 5500, "About 5,500 degrees Celsius. The corona above it is far hotter, a puzzle scientists still study."},
	{"In what year was the first iPhone released?", "", 2007, 40, "Announced in January 2007 and sold from June 2007."},
	{"How long is a marathon?", "km", 42.195, 42.195, "42.195 km (26.2 miles). The odd distance was fixed at the 1908 London Olympics."},
	{"In what year did the Berlin Wall fall?", "", 1989, 60, "On November 9, 1989. Germany reunified less than a year later."},
	{"How much does an adult human brain weigh?", "g", 1400, 1400, "About 1.4 kg. It is roughly 2% of body weight but uses about 20% of the body's energy."},
	{"How long is the Strait of Gibraltar at its narrowest point?", "km", 14, 14, "About 14 km separate Spain from Morocco at the narrowest point."},
}

// fibSet: four statements, exactly one false. Fib is its index.
type fibSet struct {
	Topic      string
	Statements [4]string
	Fib        int
	Explain    string
}

var fibBank = []fibSet{
	{"Space", [4]string{
		"A day on Venus is longer than a year on Venus.",
		"Neutron stars can spin hundreds of times per second.",
		"Sound travels easily through the vacuum of space.",
		"Jupiter's Great Red Spot is a giant storm.",
	}, 2, "Sound needs a medium such as air or water to travel through. Space is almost empty, so it is silent."},
	{"Animals", [4]string{
		"Octopuses have three hearts.",
		"Goldfish only remember things for about three seconds.",
		"A group of crows is called a murder.",
		"Properly sealed honey can stay edible for thousands of years.",
	}, 1, "Goldfish can remember things for months, and they can even be trained to respond to signals."},
	{"The human body", [4]string{
		"Humans use only about 10% of their brains.",
		"Adults have fewer bones than newborn babies.",
		"The lining of your stomach renews itself every few days.",
		"A resting heart beats roughly 100,000 times per day.",
	}, 0, "Brain imaging shows we use virtually all of the brain. The 10% idea is a myth, and different regions are active at different times."},
	{"History", [4]string{
		"Napoleon was unusually short compared with men of his time.",
		"The Great Fire of London happened in 1666.",
		"Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid.",
		"Ancient Rome had public toilets.",
	}, 0, "Napoleon was about 5 ft 6 in to 5 ft 7 in, average or slightly above for a Frenchman then. The myth comes from mixing up French and English inches."},
	{"Morocco and the world", [4]string{
		"Morocco and Spain are separated by only about 14 km at the Strait of Gibraltar.",
		"Fez is home to al-Qarawiyyin, founded in 859 by Fatima al-Fihri.",
		"Mount Toubkal, Morocco's highest peak, is in the High Atlas.",
		"Morocco is the world's largest producer of phosphate rock.",
	}, 3, "Morocco holds the largest phosphate reserves in the world, but China produces the most phosphate rock each year. Reserves and production are different things."},
	{"Science", [4]string{
		"Lightning never strikes the same place twice.",
		"A lightning bolt is hotter than the surface of the Sun.",
		"Bananas are slightly radioactive because of potassium-40.",
		"Diamond and graphite are both made of pure carbon.",
	}, 0, "Lightning strikes tall objects again and again. The Empire State Building is hit around 20 times a year."},
	{"Computing", [4]string{
		"HTTP is stateless by design.",
		"Base64 is a form of encryption.",
		"A hash function turns input of any size into a fixed-size output.",
		"Binary numbers use only the digits 0 and 1.",
	}, 1, "Base64 is an encoding, not encryption. It has no key, so anyone can reverse it instantly."},
	{"Mathematics", [4]string{
		"Zero is an even number.",
		"There are infinitely many prime numbers.",
		"Pi is exactly equal to 22/7.",
		"The angles of a triangle on a flat surface add up to 180 degrees.",
	}, 2, "22/7 is only an approximation (3.142857...). Pi is irrational, so its decimals never end or repeat."},
	{"Plants", [4]string{
		"Botanically, a banana is a berry.",
		"Botanically, a strawberry is a true berry.",
		"Peanuts are legumes, not true nuts.",
		"Tomatoes are botanically fruits.",
	}, 1, "A true berry develops from one ovary and has seeds inside. Strawberries are aggregate accessory fruits with seeds on the outside."},
	{"Language", [4]string{
		"The word algebra comes from the Arabic al-jabr.",
		"The word algorithm comes from the name of al-Khwarizmi.",
		"Arabic is written from right to left.",
		"The digits 0 to 9 were invented by the Romans.",
	}, 3, "The digits we use today are Hindu-Arabic numerals, developed in India and spread through the Arab world to Europe. Romans used letters such as V and X."},
	{"Physics", [4]string{
		"In a vacuum, heavier objects fall faster than lighter ones.",
		"On the Moon, Apollo 15 showed a hammer and a feather landing together.",
		"Sunlight takes about 8 minutes to reach the Earth.",
		"Absolute zero is about minus 273.15 degrees Celsius.",
	}, 0, "Without air resistance, all objects fall at the same rate. Galileo argued it, and Apollo 15 demonstrated it on the Moon."},
	{"Animals II", [4]string{
		"Bats are blind.",
		"Bats are the only mammals capable of true flight.",
		"Dolphins sleep with half of their brain awake.",
		"Sharks are older than trees.",
	}, 0, "Bats can see, and many species see well in dim light. Some also use echolocation to hunt."},
	{"Money", [4]string{
		"Inflation means prices rise across the economy over time.",
		"Compound interest earns interest on earlier interest.",
		"A diversified portfolio removes all investment risk.",
		"If demand rises while supply stays fixed, prices tend to rise.",
	}, 2, "Diversification reduces risk that belongs to one company, but market-wide risk remains. No portfolio is risk-free."},
	{"Health", [4]string{
		"Antibiotics work against viruses such as the flu.",
		"Vaccines train the immune system to recognise a germ.",
		"Washing hands with soap helps remove germs.",
		"Sleep helps the brain consolidate memories.",
	}, 0, "Antibiotics target bacteria. Viruses are a different kind of germ, so they do nothing against the flu or a cold."},
}

// chainQ: a chain of ideas with one missing link. Blank is the index in Nodes that is
// hidden; the player picks the right link from Options.
type chainQ struct {
	Title   string
	Nodes   []string
	Blank   int
	Options [4]string
	Answer  int
	Explain string
}

var chainBank = []chainQ{
	{"A web request", []string{"Browser", "DNS lookup", "?", "Server response", "Page rendered"}, 2,
		[4]string{"Open a TCP and TLS connection", "Compile the page", "Print the page", "Defragment the disk"}, 0,
		"After DNS gives the server's address, the browser opens a connection (TCP, then TLS for https) before it can send the request."},
	{"Evolution", []string{"Variation", "Inheritance", "?", "Adaptation over generations"}, 2,
		[4]string{"Habits acquired in life are passed on", "Individuals that fit better leave more offspring", "A designer picks the traits", "Mutations stop"}, 1,
		"Natural selection is differential reproduction: traits that help survival and reproduction become more common."},
	{"Supply and demand", []string{"Demand rises", "?", "Prices rise", "Producers supply more"}, 1,
		[4]string{"A surplus at the old price", "Taxes fall", "A shortage at the old price", "Supply vanishes"}, 2,
		"When more people want a good than is available at the old price, buyers compete and the price climbs."},
	{"Immune response", []string{"Germ enters", "?", "Antibodies are produced", "Memory cells remain"}, 1,
		[4]string{"Immune cells detect foreign antigens", "Bones thicken", "The germ is digested as food", "Blood stops flowing"}, 0,
		"Detecting an antigen triggers antibody production. Memory cells are why a second infection is usually milder."},
	{"Password storage", []string{"User sends password", "Server adds a salt", "?", "Compare with the stored hash"}, 2,
		[4]string{"Email it back to the user", "Hash the salted password", "Store it in plain text", "Encrypt it with the user's own key"}, 1,
		"Servers should store a salted hash, never the password itself. The salt makes identical passwords hash differently."},
	{"Climate", []string{"Burning fossil fuels", "?", "More heat is trapped", "Global temperature rises"}, 1,
		[4]string{"The ozone layer grows", "The oceans lose their salt", "The Sun gets brighter", "CO2 concentration increases"}, 3,
		"Burning fossil fuels releases CO2, a greenhouse gas that traps heat in the atmosphere."},
	{"From code to action", []string{"Source code", "Compiler", "?", "CPU executes"}, 2,
		[4]string{"Radio waves", "Machine code", "Pixels", "HTML"}, 1,
		"A compiler translates human-readable code into machine code, the instructions the processor actually runs."},
	{"Mountains and rain", []string{"Moist Atlantic air", "Rises over the Atlas", "?", "Rain on the windward slopes"}, 2,
		[4]string{"The air cools and water vapour condenses", "The rock melts", "The ocean evaporates completely", "The wind stops forever"}, 0,
		"This is orographic rain: rising air cools, vapour condenses, and the wet side of the mountains gets the rain."},
	{"Photosynthesis", []string{"Sunlight", "Chlorophyll captures light", "?", "Glucose and oxygen"}, 2,
		[4]string{"Plants burn wood", "Light energy drives CO2 and water to sugar", "Roots drink the light", "Leaves freeze"}, 1,
		"The light energy captured by chlorophyll powers the reaction that turns carbon dioxide and water into glucose, releasing oxygen."},
	{"Earthquakes", []string{"Heat moves in the mantle", "Plates move", "?", "Rock suddenly slips: an earthquake"}, 2,
		[4]string{"Stress builds up along plate boundaries", "The Moon pulls the plates apart", "Oceans drain away", "Gravity switches off"}, 0,
		"Plates stick at their boundaries while stress accumulates. When the rock finally slips, the stored energy is released as an earthquake."},
}

// Wacky penalties for whoever lost the most in a round. They are just for fun.
var bazaarPenalties = []string{
	"Type your next chat message like a pirate.",
	"Talk only in emojis in chat until the next round.",
	"Announce your next answer in a dramatic movie-trailer voice.",
	"Give yourself a royal title and use it in chat.",
	"Describe your last guess as if it were a cooking recipe.",
	"Chat only in rhymes until the next round.",
	"Pretend you are a sleepy robot in your next message.",
	"Introduce yourself to the room as a market vendor and pitch something silly.",
}

// Market events add a twist to a round.
const (
	eventNone  = "none"
	eventBull  = "bull"  // wins pay double
	eventCrash = "crash" // losses cost double
	eventTip   = "tip"   // a free hint
)
