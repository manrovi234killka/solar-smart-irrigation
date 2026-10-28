# Narration script

The script for the 10-minute project film, one block per scene.

## 1. hook

Picture this. A farmer who never has to walk out to the field in the dark, just to switch on a pump. One phone call, and the sun takes care of the rest. Hi, I'm glad you're here. This is Solar Smart Irrigation: the right amount of water, at the right time, powered by the sun.

## 2. stats

So, why does this matter? Watch the numbers count up. India wants fourteen lakh solar pumps on farms under PM-KUSUM. About eighty-seven percent of the groundwater we pump goes to agriculture. Drip irrigation can save thirty to sixty percent of the water, compared with flooding a field. And around eighty-five percent of farmers have small or marginal land. Small farms, big water use, and not much room for waste. So here's our goal: a pump that decides for itself, runs on sunlight, and tells the farmer why.

## 3. broll-tn

Here's a real farmer in Tamil Nadu, working her field by hand. Everything she plants depends on one thing: getting the right amount of water, at the right moment.

## 4. night

But water isn't the only problem. Safety is too. On the left, you can see what a power cut at night looks like: the farmer walks out with a torch just to switch the pump on. News reports from Telangana tell of a farmer bitten by a snake during a power cut, and a father and son electrocuted at a farm well. Now look at the right. With our system, the farmer simply makes a phone call from a safe place, answers yes, and the pump starts. See the light turn green at the pump house? That's the whole idea.

## 5. broll-paddy

And fields can be big. Paddy terraces like these need water to reach every level, so getting the timing right really matters.

## 6. field

Now, the idea in four simple words. Watch the field. Step one, sense: a soil sensor checks how wet the ground is, and right now the plants are droopy, because the soil is dry. Step two, decide: the controller asks three quick questions. Is the soil below the dry limit? Is rain coming? Are the floats okay? Step three, water: the solar pump starts, the drip line drops water at the roots, the soil gets darker, and look, the plants perk right up. Step four, talk: the farmer can do all of this with one phone call. And it all runs on a small ESP32 controller, even when the network is down.

## 7. broll-drip

This is where we want every drop to go: slowly, right at the roots, with almost nothing wasted.

## 8. solar

Power comes from the sun. Follow the sun across the sky, and notice how the panel turns to face it. The power flows through a charge controller into a twelve volt battery, and then to the pump, which sends water up the pipe and into the tank. See the tank slowly filling? In our bench prototype, a ten to twenty watt panel runs a twelve volt pump. On a real farm, we'd use a solar pump drive instead, with no battery, though that depends on the pump model. Either way, no waiting for the grid, and no diesel.

## 9. soil

Let's zoom into the soil. We use a capacitive moisture sensor. Watch the probe slide in. As water seeps down, the soil gets wetter, and the sensor's reading changes. The red line is the raw reading, and it's noisy. So we take the average of ten readings, and that's the steady green line, so one bad number never starts the pump. We also calibrate it: dry air counts as zero percent, and a glass of water as one hundred percent.

## 10. build-intro

Alright, let's build the prototype, step by step. There are eight steps. Gather the parts. Wire the solar power. Connect the soil sensor. Add the relay, pump and floats. Program the logic. Set up the app and cloud. Add voice and SMS. And finally, test everything.

## 11. step1

Step one: the parts. You can see the list building up, with a rough price for each. An ESP32 board, soil sensors, a twelve volt pump with a relay, a solar panel, a charge controller, a battery, a buck converter, two float switches, and a SIM800L module for SMS and calls. Watch the total at the bottom. It comes to about four thousand six hundred rupees, inside a budget of three to six thousand.

## 12. step2

Step two: wire the power. Watch the yellow lines draw themselves, with little dots showing the current. Panel to charge controller, charge controller to the battery, and put a fuse on the battery. Then a buck converter drops twelve volts to five for the ESP32. The pump also takes power from the battery, but only through the relay. Keep everything switched off while wiring, and check polarity twice.

## 13. step3

Step three: the soil sensor. It only has three pins. The red wire is power, to three point three volts. The grey wire is ground. And the blue wire carries the signal to GPIO thirty-four on the ESP32. Now look at the bar at the bottom: that's the live moisture reading, moving between the dry limit and the target.

## 14. step4

Step four: the relay, pump and floats. GPIO twenty-six switches the relay. The battery's positive goes to the relay's common terminal, and the other side goes to the pump, so the pump only runs when the relay closes. See the pump spinning? Two float switches, one for tank full and one for source empty, go to GPIO twenty-seven and twenty-five. Either one will stop the pump.

## 15. step5

Step five: the logic. On the left, the code writes itself, line by line. Every couple of seconds, the controller averages the moisture. If a float says stop, the pump stays off. If rain is coming, it skips. If the soil is below the dry limit, the pump starts with a timer. On the right, a little simulation shows the moisture dropping, the pump turning on, and switching off at the target. We've written a starter sketch for you, so test it with the pump unplugged first.

## 16. step6

Step six: the app and cloud. Look at the phone. When the farmer taps ON, a yellow dot carries the command through the cloud to the ESP32, and a blue dot brings the status back, so the app shows pump running. And even if the app asks for something unsafe, the controller still follows its own safety rules.

## 17. step7

Step seven: voice and SMS. Watch the call on the left. The assistant asks, start the pump now? The farmer says yes. Then an SMS travels to the pump site, the SIM800L receives it, and the ESP32 starts the pump. The SIM800L needs its own power supply that can handle short bursts. And the best part: it works on any basic phone.

## 18. step8

Step eight: test it. Each tick is one check. The sensor against a weighed soil sample. Ten automatic cycles. Each float, tripped by hand. The network, unplugged. The panel's energy over a day. And write everything down, because those numbers are our evaluation.

## 19. evalcards

So how do we judge the prototype? With six simple tests, shown here with their targets. Is the sensor within five points of the real moisture? Does the pump start and stop correctly, ten times out of ten? Do voice commands run in under thirty seconds, and never without a yes? Do the safety cut-offs work every time? Does it keep working offline? And does the panel cover the daily run? See the blinking boxes? Those results are still blank, because we haven't measured yet, and we'd rather be honest than guess.

## 20. outro

That's Solar Smart Irrigation. Sense the soil. Decide, with the sun and the weather. Water only when needed. And let the farmer talk to the pump with one phone call. Thanks for watching!

## 21. credits

All photos and video clips in this film come from Wikimedia Commons, under the free licences listed on screen.

