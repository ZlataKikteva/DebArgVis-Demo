const VIDEO_OFFSET = 77 //This value is used to tailor the video to the timestamps given in the analysis. The
// Intro of the specific video used for demonstration has an introduction of about 77s which is not captured by the data.
// In a later version,this value could be provided along with the data and read from there instead of manually setting it

const SCALE_FACTOR = 8; // factor to scale the length of nodes inside the sliding window.
const SMALLER_SCALE_FACTOR = SCALE_FACTOR / 2; // factor to scale the length of nodes beneath of the sliding window.
const SMALLEST_SCALE_FACTOR = SCALE_FACTOR / 4; // factor tp scale the nodes in the third area even more left/right.
let antiScaleFactor; // factor to scale the nodes that aren't in any of the areas. The antiScaleFactor is computed on each.
// change in the other areas to keep the boundaries of the diagram when increasing the length of nodes inside the three area.

const HALF_WINDOW_SIZE = 30; // The half size of the slider rectangle.
const SCREEN_WIDTH = window.screen.width;
const SCREEN_HEIGHT = window.screen.height;
const TEXT_BOX_WIDTH = SCREEN_WIDTH / 2; // Width of the area reserved for the transcript.
const TIME_FORMAT = d3.timeFormat('%H:%M:%S');
const curve = d3.line().curve(d3.curveBasis); // Used to create path elements for the links and adapt their path.

// Some constants regarding margins, heights and widths of the tool's parts.
const TIMELINE_MARGINS = {top: 20, right: 20, bottom: 40, left: 100};
const TIMELINE_WIDTH = SCREEN_WIDTH - TIMELINE_MARGINS.left - TIMELINE_MARGINS.right;
const TIMELINE_HEIGHT = SCREEN_HEIGHT / 3 - TIMELINE_MARGINS.top - TIMELINE_MARGINS.bottom;
const SLIDER_MARGINS = {top: 20, right: 20, bottom: 40, left: 100};
const SLIDER_WIDTH = SCREEN_WIDTH - SLIDER_MARGINS.left - SLIDER_MARGINS.right;
const SLIDER_HEIGHT = SCREEN_HEIGHT / 8 - SLIDER_MARGINS.top - SLIDER_MARGINS.bottom;
const TRANSCRIPT_MARGINS = {top: 20, right: 20, bottom: 40, left: 60};
const TRANSCRIPT_WIDTH = SCREEN_WIDTH / 2;
const TRANSCRIPT_HEIGHT = SCREEN_HEIGHT / 3;
const TOPIC_BUBBLE_MARGINS = {top: 20, right: 20, bottom: 40, left: 60};
const TOPIC_BUBBLE_WIDTH = SCREEN_WIDTH / 3;
const TOPIC_BUBBLE_HEIGHT = SCREEN_HEIGHT / 3;

let colorScale = null; // Determines which speaker is assigned which color.
let nodesInWindow = null; // A list of the nodes that are currently inside the sliding window (first area).
let prevNodesInWindow = null; // Used to check if nodes came into or out of the sliding window to prevent unnecessary position updates.
let nodesFarLeftOfWindow = []; // Contains a list of nodes that are part of the third area which is scaled with the smallest scale factor.
let nodesLeftOfWindow = []; // Contains a list of nodes that are part of the second area which is next to the sliding window.
let nodesRightOfWindow = []; // Contains a list of nodes that are part of the second area which is next to the sliding window.
let nodesFarRightOfWindow = []; // Contains a list of nodes that are part of the third area which is scaled with the smallest scale factor.
let xScale = null; // xScale of both, slider and timeline.
let yScale; // yScale of the timeline.
let radius; // The radius of the topic bubbles depends on the given space and the number of bubbles.
let nodeData; // Contains the original node data from the backend.
let linkData; // Contains the original link data from the backend.
let nodes; // References the "nodes" in the timeline. Selection of the node rectangle in the timeline svg.
let nodes_slider; // References the "nodes" in the slider svg.
let links; // References a selection of the links (svg path elements) in the timeline svg.
let textBox; // References a selection of a svg <g> element containing the text (and text backgrounds) in the transcript.
let ticks; // References the x-axis ticks of the timeline.

let transcript; // The transcript svg.
let topicBubbles; // The topic bubble svg.
let timeline; // The timeline svg.
let slider; // The slider svg.
let videoplayer = document.getElementById('videoPlayer'); // The videoplayer html element.
let userIsInteracting = true

/**
 * Uses the data from the backend to create all elements of the visualization.
 *
 * @param graphData The input data from the backend.
 */
function createSlidingTimeline(graphData) {
    const topicData = Object.values(graphData["topics"]);
    nodeData = graphData.nodes;
    linkData = graphData.links;

    parseTimeData();
    let speakers = Array.from(new Set(nodeData.map(function (d) { // Returns a list of speakers from the data
        return d.speaker;
    })));
    xScale = d3.scaleTime()
        .domain([d3.min(nodeData, function (d) {
            return d.start_time;
        }), d3.max(nodeData, function (d) {
            return d.end_time;
        }),])
        .range([0, SLIDER_WIDTH]);
    colorScale = createColorScale(speakers);

    createSlider(speakers);
    addVideoPlayerInteraction();
    createTimeline(speakers);
    createTranscript();
    createTopicBubbles(topicData);
}

/**
 * Creates the x-axis and y-axis of the slider.
 *
 * @param yScaleSlider The y-scale of the slider. The x-scale is shared between timeline and slider.
 */
function createSliderAxis(yScaleSlider) {
    let xAxis2 = d3.axisBottom(xScale).tickFormat(TIME_FORMAT);
    slider.append('g')
        .attr('transform', 'translate(0,' + SLIDER_HEIGHT + ')')
        .call(xAxis2);
    let yAxis2 = d3.axisLeft(yScaleSlider);
    slider.append('g')
        .call(yAxis2);
}

/**
 * Creates the slider svg including the slider rectangle which can be moved to "zoom" in the timeline while having a
 * fisheye effect.
 *
 * @param speakers A name list of the persons speaking in the visualized debate.
 */
function createSlider(speakers) {
    slider = createSVG('#slider', SLIDER_WIDTH, SLIDER_HEIGHT, SLIDER_MARGINS);
    slider.append('rect') // Adds an "invisible" background rectangle to the slider svg to allow setting the slider position on click
        .attr("class", "slider-background")
        .attr("x", 0)
        .attr("y", 0)
        .attr("height", SLIDER_HEIGHT)
        .attr("width", SLIDER_WIDTH)
        .on("click", sliderClickAction())
    let yScaleSlider = d3.scaleBand().domain(speakers).range([SLIDER_HEIGHT, 0]).padding(0.1); // Creates a y-scale for the slider .
    createSliderAxis(yScaleSlider); // Creates x and y axis.

    nodes_slider = createSliderNodes(yScaleSlider); // Creates the rectangles representing the nodes.
    slider.append('rect') // Adds the slider rectangle and puts it left of the diagram.
        .attr('class', 'mouse-rectangle')
        .attr('width', 2 * HALF_WINDOW_SIZE)
        .attr('height', SLIDER_HEIGHT)
        .attr('x', -2 * HALF_WINDOW_SIZE)
    addSliderInteraction(); // Adds the slider functionality.
}

function sliderClickAction() {
    return function (event) {
        videoplayer.pause();
        const mouseX = d3.pointer(event)[0];
        moveSlider(mouseX);
    };
}

/**
 * Adds the fisheye effect functionality in the timeline, when moving the slider rectangle. The rectangle has to be
 * clicked on and dragged. Alternatively, a position in the slider diagram can be clicked at and the slider rectangle is
 * set to that position. Moving the slider always pauses the video.
 */
function addSliderInteraction() {
    let isDragging = false;
    slider.on('mousedown', function () {
        isDragging = true;
    });
    d3.select('body').on('mouseup', function () {
        if (isDragging) {
            isDragging = false;
        }
    });
    slider.on('mousemove', function (event) {
        if (isDragging) {
            videoplayer.pause();
            const mouseX = d3.pointer(event)[0];
            moveSlider(mouseX);
        }
    }).on("click", sliderClickAction());
}

/**
 * Adds the slider functionality to the videoplayer by computing the x value of the current time of the video and setting
 * the slider rectangle to the respective position.
 */
function addVideoPlayerInteraction() {
    videoplayer.addEventListener('timeupdate', function () {
        const currentTimeVidX = xScale(new Date(nodeData[0].start_time.getTime() -VIDEO_OFFSET*1000 + videoplayer.currentTime * 1000)); // starts centered around the first node
        userIsInteracting = false
        moveSlider(currentTimeVidX);
    });
}

/**
 * Updates the position of the slider rectangle, and updates the diagram, if the content of the sliding window has changed.
 *
 * @param xValue The new focus point, i.e. the position the center of the sliding window is moved to.
 */
function moveSlider(xValue) {
    let mouseRectangle = slider.select(".mouse-rectangle");
    xValue = Math.min(xValue, TIMELINE_WIDTH - HALF_WINDOW_SIZE)
    mouseRectangle
        .attr('x', Math.min(Math.max(xValue - HALF_WINDOW_SIZE, -2 * HALF_WINDOW_SIZE), TIMELINE_WIDTH - HALF_WINDOW_SIZE))
        .attr('opacity', 0.5);
    groupNodes(xValue);
    if (!(prevNodesInWindow && (nodesInWindow[0] === prevNodesInWindow[0] &&
        nodesInWindow[nodesInWindow.length - 1] === prevNodesInWindow[prevNodesInWindow.length - 1]))) { // If there was a change in nodesInWindow since the last update
        updateDiagram(xValue);
        prevNodesInWindow = nodesInWindow;
    }

    let currentSeconds = xScale.invert(xValue).getSeconds() + xScale.invert(xValue).getMinutes()*60 + xScale.invert(xValue).getHours()*3600
    let secondsStart = nodeData[0].start_time.getSeconds() + nodeData[0].start_time.getMinutes()*60 + nodeData[0].start_time.getHours()*3600
    let secondsFromStart = currentSeconds - secondsStart
    if (userIsInteracting){
        videoplayer.currentTime = secondsFromStart + VIDEO_OFFSET
    }
    userIsInteracting = true
}

/**
 * Creates the plain x-axis and the y-axis of the slider.
 *
 * @param yScaleTimeline The y-scale of the slider. The x-scale is shared between timeline and slider.
 */
function createAxis(yScaleTimeline) {
    let xAxis3 = d3.axisBottom(xScale).ticks(0);
    timeline.append('g')
        .attr('transform', 'translate(0,' + TIMELINE_HEIGHT + ')')
        .call(xAxis3);

    let yAxis3 = d3.axisLeft(yScaleTimeline);
    timeline.append('g')
        .call(yAxis3);
}

/**
 * Creates the timeline svg and associates the links of the timeline with its nodes by applying a force simulation.
 * Then creates the nodes, represented by rect elements, the links represented by path elements, and the x-axis ticks,
 * represented by a combined element of a vertical line and a timestamp. After that, the interaction methods with the
 * timeline are added.
 *
 * @param speakers A list of names of the different speakers in the visualized debate.
 */
function createTimeline(speakers) {
    timeline = createSVG('#time', TIMELINE_WIDTH, TIMELINE_HEIGHT, TIMELINE_MARGINS);
    yScale = d3.scaleBand()
        .domain(speakers)
        .range([TIMELINE_HEIGHT, 0])
        .padding(0.1);

    createAxis(yScale);
    d3.forceSimulation(nodeData).force('link', d3.forceLink(linkData).id(d => d.id).distance(30));
    createArrowheadMarker();
    nodes = createNodeGroup(colorScale);
    links = createLinks();
    ticks = createTicks();

    addTimelineInteraction();
}

/**
 * Adds highlighting methods for hovering on and off a node and a method for clicking on a node. Clicking on a node sets
 * the time of the videoplayer to the time of the node, which also triggers the slider functionality.
 */
function addTimelineInteraction() {
    nodes.on('mouseover', (event, d) => {
        hoverAction(event, d);
    }).on('mouseout', (event, d) => {
        unHoverAction(event, d);
    }).on('click', (event, d) => {
        const mouseX = xScale(d.start_time);
        moveSlider(mouseX)
    });
}

/**
 * Creates the transcript svg including a background rectangle and the transcript text box which contains the text
 * respective to the nodes that are inside the sliding window or the whole text if the sliding window is empty.
 */
function createTranscript() {
    transcript = createSVG('#transcript', TRANSCRIPT_WIDTH, TRANSCRIPT_HEIGHT, TRANSCRIPT_MARGINS);
    transcript.append("rect", "box")
        .attr("class", "background-rectangle")
        .attr('y', -20)
        .attr('x', 0)
        .attr('width', SCREEN_WIDTH / 2 + 20)
        .attr('height', 1 / 3 * SCREEN_HEIGHT + 60)
        .on("wheel", scrollText);
    addTranscriptText();
}

/**
 * Iterates over the nodes and distributes them to the lists representing the areas including and around the sliding
 * window. The lists are disjoint and not every node is in one of the lists if they are too distant from the center of
 * the sliding window.
 *
 * @param mouseX The position of the center of the sliding window rectangle.
 */
function groupNodes(mouseX) {
    nodesInWindow = [];
    nodesFarLeftOfWindow = [];
    nodesLeftOfWindow = [];
    nodesRightOfWindow = [];
    nodesFarRightOfWindow = [];
    nodeData.forEach(function (d) {
        const barX = xScale(d.start_time);
        const barWidth = xScale(d.end_time) - barX;
        if (barX <= mouseX + HALF_WINDOW_SIZE && barX + barWidth >= mouseX - HALF_WINDOW_SIZE) {
            nodesInWindow.push(d);
        } else if (barX + barWidth >= mouseX - 3 * HALF_WINDOW_SIZE && barX < mouseX - 2 * HALF_WINDOW_SIZE) {
            nodesFarLeftOfWindow.push(d);
        } else if (barX + barWidth >= mouseX - 2 * HALF_WINDOW_SIZE && barX < mouseX - HALF_WINDOW_SIZE) {
            nodesLeftOfWindow.push(d);
        } else if (barX < mouseX + 2 * HALF_WINDOW_SIZE && barX + barWidth >= mouseX + HALF_WINDOW_SIZE) {
            nodesRightOfWindow.push(d);
        } else if (barX < mouseX + 3 * HALF_WINDOW_SIZE && barX + barWidth >= mouseX + 2 * HALF_WINDOW_SIZE) {
            nodesFarRightOfWindow.push(d);
        }
    });
}

/**
 * Adds a textbox in the color of a speaker at a specific position and fits the text into it.
 *
 * @param y The y value of the node to which the textbox should be appended.
 * @param x The x value of the node to which the textbox should be appended.
 * @param speaker The speaker.
 * @param text The text to be wrapped and displayed.
 */
function addNodeTextbox(y, x, speaker, text) {
    let height = TIMELINE_HEIGHT / 3;
    let width = TIMELINE_WIDTH / 8;
    let above = y + yScale.bandwidth() + height > TIMELINE_HEIGHT
    let rectY = above ? y - height - 5 : y + yScale.bandwidth() + 5;
    let rectX = Math.max(Math.min(x - 0.5 * width, TIMELINE_WIDTH - width), 1);
    let triangleY = above ? y - 5 : y + yScale.bandwidth() + 5;
    let trianglePeakY = above ? y : y + yScale.bandwidth();
    timeline.append("rect")
        .attr("class", 'node-text-box')
        .attr("x", rectX)
        .attr("y", rectY)
        .attr("height", height)
        .attr("width", width)
        .attr("fill", colorScale(speaker));
    let textElement = timeline.append("text").attr("class", 'node-text');
    let words = text.split(" ");
    let defaultX = 5
    let currentY = 1.2
    let line = []
    let tspan = textElement.append("tspan").attr("x", rectX + defaultX).attr("y", rectY).attr("dy", currentY + "em");
    words.forEach(word => {
        line.push(word);
        tspan.text(line.join(" "));
        if (tspan.node().getComputedTextLength() > width - 5) {
            line.pop();
            tspan.text(line.join(" "));
            line = [word];
            currentY += 1.2;
            tspan = textElement.append("tspan").attr("x", rectX + defaultX).attr("y", rectY).attr("dy", currentY + "em").text(word);
        }
    });
    timeline.append("polygon")
        .attr("class", 'node-text-box')
        .attr("points", [
            `${Math.min(x + 5, rectX + width)},${triangleY}`,
            `${Math.max(x - 5, rectX)},${triangleY}`,
            `${x},${trianglePeakY}`
        ].join(" "))
        .attr("fill", colorScale(speaker))
}

/**
 * Adds a textbox with the text of a node beneath the respective node..
 *
 * @param outsideNodes A selection of nodes where text should be appended.
 */
function appendNodeText(outsideNodes) {
    outsideNodes.each(node => {
        let n = timeline.select("#node-" + node.id);
        let x = parseFloat(n.attr("x")) + parseFloat(n.attr("width")) / 2;
        let y = yScale(node.speaker);
        let text = node.text
        let speaker = node.speaker
        addNodeTextbox(y, x, speaker, text);
    })
}

/**
 * Adds a centered text centered at the middle of a link, describing the link further.
 *
 * @param links A selection of the links where text should be added.
 * @param sourceNode The source node of these links.
 */
function appendLinkText(links, sourceNode) {
    links.each(link => {
        let targetNode = timeline.select('#node-' + link.target.id);
        let sourceNodeMidX = parseFloat(sourceNode.attr("x")) + 0.5 * parseFloat(sourceNode.attr("width"));
        let targetNodeMidX = parseFloat(targetNode.attr("x")) + 0.5 * parseFloat(targetNode.attr("width"));
        let midX = sourceNodeMidX + (targetNodeMidX - sourceNodeMidX) / 2;
        let sourceNodeY = yScale(sourceNode.data()[0].speaker);
        let targetNodeY = yScale(targetNode.data()[0].speaker);
        let adaptY = link.text_additional === "Default Conflict" ? yScale.bandwidth() + 20 : -15;
        let midY = sourceNodeY + (targetNodeY - sourceNodeY) / 2 + adaptY;
        timeline.append("text")
            .attr("class", "link-text")
            .attr("x", midX)
            .attr("y", midY)
            .text(link.conn_type)
            .attr("fill", getLinkColor(link.text_additional, link.conn_type));
    });
}

/**
 * Creates the svg rectangles for representing nodes in the timeline and returns a selection of them.
 *
 * @returns A selection of the svg elements.
 */
function createNodeGroup() {
    return timeline.selectAll('.node-group')
        .data(nodeData)
        .enter()
        .append('rect')
        .attr('class', 'node')
        .attr('width', d => xScale(d.end_time) - xScale(d.start_time))
        .attr('height', yScale.bandwidth())
        .attr("x", d => xScale(d.start_time))
        .attr("y", d => yScale(d.speaker))
        .attr('fill', d => colorScale(d.speaker))
        .attr("class", "node-group")
        .attr('id', d => 'node-' + d.id);
}

/**
 * Creates ticks for the x-axis of the timeline. Ticks are represented by svg g elements that contain a vertical line
 * and by a timestamp. The timestamp is taken from some nodes and the height of the vertical line is relative to the
 * y-value of the node, the shares the timestamp.
 *
 * @returns A selection of the svg elements.
 */
function createTicks() {
    let nodesToShowText = findNodesToShowText();
    let ticks = timeline.selectAll('.ticks')
        .data(nodeData.filter((d, i) => nodesToShowText[i]))
        .enter()
        .append("g")
        .attr("class", "ticks")
        .attr('transform', d => `translate(${xScale(d.start_time)}, ${yScale(d.speaker)})`);
    ticks.append('line')
        .attr('class', 'additional-line')
        .attr('x1', 0)
        .attr('y1', yScale.bandwidth())
        .attr('x2', 0)
        .attr('y2', d => TIMELINE_HEIGHT - yScale(d.speaker) + 5)
    ticks.append('text')
        .attr('class', 'bar-text')
        .attr('x', 0)
        .attr('y', d => TIMELINE_HEIGHT - yScale(d.speaker) + 10)
        .text(d => d3.timeFormat(TIME_FORMAT)(d.start_time))
    return ticks;
}

/**
 * Creates the svg path elements for representing links in the timeline and returns a selection of them.
 *
 * @returns A selection of the svg elements.
 */
function createLinks() {
    return timeline.selectAll('.link')
        .data(linkData)
        .enter().append('path')
        .attr('class', 'link')
        .attr('marker-end', d => getArrowHeadColor(d.text_additional, d.conn_type))
        .attr('stroke', d => getLinkColor(d.text_additional, d.conn_type))
        .attr('d', d => computePath(d));
}

/**
 * Creates defs elements for arrow heads that the links can use.
 */
function createArrowheadMarker() {
    timeline.append('defs').append('marker')
        .attr('class', 'arrowhead')
        .attr('id', 'arrowhead-red')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 3)
        .attr('markerHeight', 4)
        .attr('xoverflow', 'visible')
        .append('svg:path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'red');
    timeline.append('defs').append('marker')
        .attr('class', 'arrowhead')
        .attr('id', 'arrowhead-violet')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 3)
        .attr('markerHeight', 4)
        .attr('xoverflow', 'visible')
        .append('svg:path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'violet');
    timeline.append('defs').append('marker')
        .attr('class', 'arrowhead')
        .attr('id', 'arrowhead-green')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 3)
        .attr('markerHeight', 4)
        .attr('xoverflow', 'visible')
        .append('svg:path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'green');
    timeline.append('defs').append('marker')
        .attr('class', 'arrowhead')
        .attr('id', 'arrowhead-green')
        .attr('viewBox', '-0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('orient', 'auto')
        .attr('markerWidth', 3)
        .attr('markerHeight', 4)
        .attr('xoverflow', 'visible')
        .append('svg:path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', 'orange');
}

/**
 * Computes the new x value of each node by identifying the area they are in and adding the scaled distance from the
 * unscaled start point of the first node in that area to the new start point of the first node in that same area. This
 * utilizes the fact that the scaling is linear inside each area.
 *
 * @param d The node whose x value is to be scaled.
 * @param mouseX The center of the sliding window, in order to determine which area a node is in.
 * @param defaultXValues An array of the start x values of the first node in each area.
 * @param adaptedXValues An array of the adapted/scaled x values of the first node in each area.
 * @returns The new x position of the node d.
 */
function determineXValue(d, mouseX, defaultXValues, adaptedXValues) {
    const barX = xScale(d.start_time);
    const barWidth = xScale(d.end_time) - barX;
    if (barX < defaultXValues[0]) {
        return barX * antiScaleFactor;
    } else if (barX + barWidth >= defaultXValues[0] && barX < defaultXValues[1]) {
        return adaptedXValues[0] + (barX - defaultXValues[0]) * SMALLEST_SCALE_FACTOR;
    } else if (barX + barWidth >= defaultXValues[1] && barX < defaultXValues[2]) {
        return adaptedXValues[1] + (barX - defaultXValues[1]) * SMALLER_SCALE_FACTOR;
    } else if (barX <= defaultXValues[3] && barX + barWidth >= defaultXValues[2]) {
        return adaptedXValues[2] + (barX - defaultXValues[2]) * SCALE_FACTOR;
    } else if (barX < defaultXValues[4] && barX + barWidth >= defaultXValues[3]) {
        return adaptedXValues[3] + (barX - defaultXValues[3]) * SMALLER_SCALE_FACTOR;
    } else if (barX < defaultXValues[5] && barX + barWidth >= defaultXValues[4]) {
        return adaptedXValues[4] + (barX - defaultXValues[4]) * SMALLEST_SCALE_FACTOR;
    } else {
        return adaptedXValues[5] + (barX - defaultXValues[5]) * antiScaleFactor;
    }
}

/**
 * Returns a color based on the input string. This method is used to color the links depending on their additional
 * information and their type. There are three types of links, Default Inference, Default Rephrase and Default Conflict.
 *
 * @param textAdditional The additional information of a link.
 * @param connType The type of the node, e.g. Agreeing or Restating
 * @returns The respective color.
 */
function getLinkColor(textAdditional, connType) {
    if (textAdditional === 'Default Inference' || connType === 'Agreeing') {
        return 'green';
    } else if (connType === 'Answering') {
        return 'orange';
    } else if (textAdditional === 'Default Rephrase') {
        return 'violet';
    } else if (textAdditional === 'Default Conflict') {
        return 'red'
    } else {
        return 'white'
    }
}

/**
 * Returns a string to address an arrowhead type based on the input string. This method is used to find the correct
 * colored arrowhead for the links depending on their additional information and the connection type. There are three
 * types of links, Default Inference, Default Rephrase and Default Conflict.
 *
 * @param textAdditional The additional information of a link.
 * @param connType The connection type.
 * @returns The respective string to address the arrow head.
 */
function getArrowHeadColor(textAdditional, connType) {
    if (textAdditional === 'Default Inference' || connType === 'Agreeing') {
        return 'url(#arrowhead-green)';
    } else if (connType === 'Answering') {
        return 'url(#arrowhead-orange)';
    } else if (textAdditional === 'Default Rephrase') {
        return 'url(#arrowhead-violet)';
    } else if (textAdditional === 'Default Conflict') {
        return 'url(#arrowhead-red)';
    } else {
        return 'url(#arrowhead)';
    }
}

/**
 * Parses the time from the json objects into date objects for every node in the data.
 */
function parseTimeData() {
    nodeData.forEach(function (d) {
        d.start_time = new Date(d.part_time);
        d.end_time = new Date(d.end_part_time);
    });
}

/**
 * Creates a new svg element.
 *
 * @param selector The id of the new svg.
 * @param width The width of the new svg.
 * @param height The height of the new svg.
 * @param margin An array containing the margins for the new svg.
 * @returns An selection of the new svg element.
 */
function createSVG(selector, width, height, margin) {
    return d3.select(selector)
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
        .append('g')
        .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
}

/**
 * Creates a color scale.
 *
 * @param domain A list of objects that should be colored in the color scale.
 * @returns The color scale.
 */
function createColorScale(domain) {
    return d3.scaleOrdinal().domain(domain).range(d3.schemeCategory10);
}

/**
 * Creates the svg rectangles for representing nodes in the slider and returns a selection of them.
 *
 * @param yScaleSlider The y scale of the slider
 * @returns A selection of the svg elements.
 */
function createSliderNodes(yScaleSlider) {
    return slider.selectAll('.node')
        .data(nodeData)
        .enter().append('rect')
        .attr('class', 'node')
        .attr('x', d => xScale(d.start_time))
        .attr('y', d => yScaleSlider(d.speaker))
        .attr('width', d => xScale(d.end_time) - xScale(d.start_time))
        .attr('height', yScaleSlider.bandwidth())
        .attr('fill', d => colorScale(d.speaker));
}

/**
 * Determines the new bar width of a scaled node depending on the area the node is in. For that, the regular bar width
 * is multiplied with the respective scale factor.
 *
 * @param d The node to get a new bar width.
 * @param defaultXValues An array of the start x values of the first node in each area.
 * @returns The new bar width of the node d.
 */
function computeBarWidth(d, defaultXValues) {
    const barX = xScale(d.start_time);
    const barWidth = xScale(d.end_time) - barX;
    if (barX < defaultXValues[0]) {
        return barWidth * antiScaleFactor;
    } else if (barX + barWidth >= defaultXValues[0] && barX < defaultXValues[1]) {
        return barWidth * SMALLEST_SCALE_FACTOR;
    } else if (barX + barWidth >= defaultXValues[1] && barX < defaultXValues[2]) {
        return barWidth * SMALLER_SCALE_FACTOR;
    } else if (barX < defaultXValues[3] && barX + barWidth >= defaultXValues[2]) {
        return barWidth * SCALE_FACTOR;
    } else if (barX < defaultXValues[4] && barX + barWidth >= defaultXValues[3]) {
        return barWidth * SMALLER_SCALE_FACTOR;
    } else if (barX < defaultXValues[5] && barX + barWidth >= defaultXValues[4]) {
        return barWidth * SMALLEST_SCALE_FACTOR;
    } else {
        return barWidth * antiScaleFactor;
    }
}

/**
 * Creates a fisheye effect by scaling the bars in the timeline with three different scale factors depending on the area
 * a node is in (which again depends on the nodes distance to the center of the sliding window). Nodes outside the scaled
 * areas are scaled with an anti-scale-factor that depends on the remaining space after scaling. At first, the original
 * positions of the first and/or last node in every is taken to determine the new length of each area by applying te
 * respective scale factor to the original length. Then, the anti-scale-factor can be determined by dividing the original
 * space left for the nodes outside the areas by the space left after scaling the areas. After that, the new positions of
 * the nodes at the beginning/end of each area can be determined which allows fast computation of the new positions of
 * each node/link/x-axis tick inside an area. Additionally, the opacities are manipulated so the nodes and links in the
 * sliding window have always full opacity. The opacity of the links is area-wise lower depending on the distance to the
 * sliding window. Links outside the areas have an opacity of 0. Also, the width of the nodes in the timeline is adapted.
 *
 * @param mouseX The center of the sliding window and therefore the center of the fisheye effect.
 */
function updatePositions(mouseX) {
    // Original start points.
    const firstScaledNodeX = nodesInWindow.length !== 0 ? xScale(nodesInWindow[0].start_time) : 0;
    const firstScaledNodeXLeft = nodesLeftOfWindow.length !== 0 ? xScale(nodesLeftOfWindow[0].start_time) : 0;
    const firstScaledNodeXFarLeft = nodesFarLeftOfWindow.length !== 0 ? xScale(nodesFarLeftOfWindow[0].start_time) : 0;
    const firstScaledNodeXRight = nodesRightOfWindow.length !== 0 ? xScale(nodesRightOfWindow[0].start_time) : xScale(nodeData[nodeData.length - 1].end_time);
    const firstScaledNodeXFarRight = nodesFarRightOfWindow.length !== 0 ? xScale(nodesFarRightOfWindow[0].start_time) : xScale(nodeData[nodeData.length - 1].end_time);
    const lastScaledNodeXFarRight = nodesFarRightOfWindow.length !== 0 ? xScale(nodesFarRightOfWindow[nodesFarRightOfWindow.length - 1].end_time) : xScale(nodeData[nodeData.length - 1].end_time);

    // Area lengths.
    const farLeftLength = (firstScaledNodeXLeft - firstScaledNodeXFarLeft) * SMALLEST_SCALE_FACTOR;
    const leftLength = (firstScaledNodeX - firstScaledNodeXLeft) * SMALLER_SCALE_FACTOR;
    const windowLength = (firstScaledNodeXRight - firstScaledNodeX) * SCALE_FACTOR;
    const rightLength = (firstScaledNodeXFarRight - firstScaledNodeXRight) * SMALLER_SCALE_FACTOR;
    const farRightLength = (lastScaledNodeXFarRight - firstScaledNodeXFarRight) * SMALLEST_SCALE_FACTOR;

    // Computation of the anti-scale factor.
    const diagramLength = xScale(d3.max(nodeData, d => d.end_time));
    const unscaledAreaLength = diagramLength - (lastScaledNodeXFarRight - firstScaledNodeXFarLeft);
    const antiScaledAreaLength = diagramLength - (farLeftLength + leftLength + windowLength + rightLength + farRightLength);
    antiScaleFactor = antiScaledAreaLength / unscaledAreaLength;

    // New start positions of the first node of an area after scaling.
    const adaptedFirstXFarLeft = firstScaledNodeXFarLeft * antiScaleFactor;
    const adaptedFirstXLeft = adaptedFirstXFarLeft + farLeftLength;
    const adaptedFirstX = adaptedFirstXLeft + leftLength;
    const adaptedFirstXRight = adaptedFirstX + windowLength;
    const adaptedFirstXFarRight = adaptedFirstXRight + rightLength;
    const adaptedFirstXAreaAfter = adaptedFirstXFarRight + farRightLength;

    const defaultXValues = [firstScaledNodeXFarLeft, firstScaledNodeXLeft, firstScaledNodeX, firstScaledNodeXRight, firstScaledNodeXFarRight, lastScaledNodeXFarRight];
    const adaptedXValues = [adaptedFirstXFarLeft, adaptedFirstXLeft, adaptedFirstX, adaptedFirstXRight, adaptedFirstXFarRight, adaptedFirstXAreaAfter];

    nodes_slider.attr('opacity', function (d) {
        const barX = xScale(d.start_time);
        return barX < firstScaledNodeXRight && barX >= firstScaledNodeX ? 1.0 : 0.2;
    });
    ticks
        .attr('transform', d => `translate(${determineXValue(d, mouseX, defaultXValues, adaptedXValues)}, ${yScale(d.speaker)})`);
    nodes
        .attr("x", d => determineXValue(d, mouseX, defaultXValues, adaptedXValues))
        .attr('width', d => computeBarWidth(d, defaultXValues))
        .attr('opacity', function (d) {
            const barX = xScale(d.start_time);
            return barX < firstScaledNodeXRight && barX >= firstScaledNodeX ? 1.0 : 0.2;
        });
    links
        .attr('d', d => {
            const adapt_y = d.text_additional === "Default Conflict" ? yScale.bandwidth() + 15 : -10;
            const adapt_start_y = d.text_additional === "Default Conflict" ? yScale.bandwidth() : 0;
            const barWidthSource = computeBarWidth(d.source, defaultXValues);
            const barWidthTarget = computeBarWidth(d.target, defaultXValues);
            const xMidSource = (determineXValue(d.source, mouseX, defaultXValues, adaptedXValues)) + barWidthSource / 2;
            const xMidTarget = (determineXValue(d.target, mouseX, defaultXValues, adaptedXValues)) + barWidthTarget / 2;
            const yMidSource = yScale(d.source.speaker) + adapt_y;
            const yMidTarget = yScale(d.target.speaker) + adapt_y;
            const pathData = [
                [xMidSource, yScale(d.source.speaker) + adapt_start_y],
                [xMidSource, yMidSource],
                [xMidTarget, yMidTarget],
                [xMidTarget, yScale(d.target.speaker) + adapt_start_y]
            ];
            return curve(pathData);
        })
        .attr('opacity', d => {
            let xValue = xScale(d.source.start_time);
            if ((xValue >= defaultXValues[0] && xValue < defaultXValues[1]) || (xValue < defaultXValues[5] && xValue >= defaultXValues[4])) {
                return 0.15;
            } else if ((xValue >= defaultXValues[1] && xValue < defaultXValues[2]) || (xValue < defaultXValues[4] && xValue >= defaultXValues[3])) {
                return 0.3;
            } else if (xValue <= defaultXValues[3] && xValue >= defaultXValues[2]) {
                return 1.0;
            } else {
                return 0;
            }
        });
}

/**
 * Computes the path of the path elements (i.e. the links) based on the position of their source and target node. Links
 * that are representing "Default Conflict" are below their source and target nodes in the timeline while the other link
 * types are connecting them from the middle of the upper border of the source bar to the middle of the upper border of
 * the target bar.
 *
 * @param link The link whose path is computed.
 * @returns The path of the link.
 */
function computePath(link) {
    const adapt_y = link.text_additional === "Default Conflict" ? yScale.bandwidth() + 15 : -10;
    const adapt_start_y = link.text_additional === "Default Conflict" ? yScale.bandwidth() : 0;
    const barWidthSource = xScale(link.source.end_time) - xScale(link.source.start_time);
    const barWidthTarget = xScale(link.target.end_time) - xScale(link.target.start_time);
    const xMidSource = xScale(link.source.start_time) + barWidthSource / 2;
    const xMidTarget = xScale(link.target.start_time) + barWidthTarget / 2;
    const yMidSource = yScale(link.source.speaker) + adapt_y;
    const yMidTarget = yScale(link.target.speaker) + adapt_y;
    const pathData = [
        [xMidSource, yScale(link.source.speaker) + adapt_start_y],
        [xMidSource, yMidSource],
        [xMidTarget, yMidTarget],
        [xMidTarget, yScale(link.target.speaker) + adapt_start_y]
    ]
    return curve(pathData);
}

/**
 * Updates the positions of nodes, links, and ticks in the timeline, depending on the current position of the focus
 * point / the center of the sliding window. Removes the old transcript text and replaces it with the text of the nodes
 * that are currently inside the sliding window. If the sliding window is empty, the timeline elements are set to their
 * default positions instead.
 *
 * @param mouseX The center of the sliding window.
 */
function updateDiagram(mouseX) {
    if (nodesInWindow.length > 0) {
        updatePositions(mouseX);
    } else {
        userIsInteracting = true
        nodes_slider.attr('opacity', 1.0);
        nodes.attr('opacity', 1.0).attr('x', d => xScale(d.start_time)).attr('width', d => xScale(d.end_time) - xScale(d.start_time));
        links.attr('opacity', 1.0).attr('d', d => computePath(d));
        ticks.attr('transform', d => `translate(${xScale(d.start_time)}, ${yScale(d.speaker)})`);
    }
    textBox.remove();
    addTranscriptText();
}

/**
 * Can be triggered by either hovering over a node (svg rect element) in the timeline or a text element in the
 * transcript and highlights the element and the respective element in the other svg. Also highlights the links
 * connected to a node in the timeline and adds text to the center of the link, describing the purpose of the link
 * further. Also colors the text of their target nodes in the transcript in the color of the link. If a link has a
 * target node outside the sliding window, the target node is also highlighted and its text is written below it. If the
 * Hovered on node lies outside the window, its text is additionally written above it.
 * Highlighting happens partially via reducing the opacity of everything but the elements to be highlighted.
 * If the text or the text of the hovered node contains any word that can be found in one or more of the topic bubbles,
 * these are also highlighted.
 *
 * @param event The hovering event.
 * @param d The hovered node data. It especially contains the id of the node, with which a node in the timeline and a
 * text element in the transcript can be associated.
 */
function hoverAction(event, d) {
    timeline.select('#node-' + d.id).attr('stroke', 'black');

    if (nodesInWindow?.length > 0 && !nodesInWindow.map(n => n.id).includes(d.id)) {
        appendNodeText(timeline.select('#node-' + d.id), true);
        timeline.select('#node-' + d.id).attr('opacity', 1);
    } else {
        transcript.select('#hovered-text-' + d.id).attr("font-style", "italic").attr("text-decoration", "underline");
        nodesInWindow ? links.filter(l => nodesInWindow.includes(l.source)).attr('opacity', 0.3) : links.attr("opacity", 0.3);
        let outgoingLinks = links.filter(l => l.source.id === d.id);
        appendLinkText(outgoingLinks, timeline.select('#node-' + d.id));
        outgoingLinks.attr("opacity", 1.0).each(l => {
            if (nodesInWindow?.length > 0 && !nodesInWindow.map(n => n.id).includes(l.target.id)) {
                appendNodeText(timeline.select('#node-' + l.target.id), false);
            }
            transcript.select('#hovered-text-' + l.target.id).attr('fill', getLinkColor(l.text_additional, l.conn_type));
        })
    }
    const textBubbles = topicBubbles.selectAll(".topic-bubble");
    textBubbles.each(function () {
        const bubble = d3.select(this);
        const bubbleTexts = bubble.selectAll(".word");
        bubbleTexts.each(function () {
            const text = d3.select(this).text();
            if (d.text.includes(text)) {
                bubble.selectAll(".bubble").transition().attr("fill", "#b794f4").attr('r', radius * 1.2);
            }
        });
    });
}

/**
 * Resets all the highlighting from the nodes in the timeline, the text elements in the transcript and the topic bubbles.
 * Removes link texts and the text added below or above nodes outside the sliding window. Resets opacities to the default,
 * especially those of the links, that have an opacity depending on the distance to the sliding window, if it exists.
 *
 * @param event The un-hovering event.
 * @param d The node data of the un-hovered element. It especially contains the id of the node, with which a node in the timeline and a
 * text element in the transcript can be associated.
 */
function unHoverAction(event, d) {
    timeline.select('#node-' + d.id).attr('stroke', 'none');
    transcript.select('#hovered-text-' + d.id).attr("font-style", "normal").attr("text-decoration", "none")
    if (nodesInWindow && nodesInWindow.length > 0) {
        links.each(function (d) {
            if (nodesInWindow.includes(d.source)) {
                d3.select(this).attr('opacity', 1.0);
            } else if (nodesRightOfWindow.includes(d.source) || nodesLeftOfWindow.includes(d.source)) {
                d3.select(this).attr('opacity', 0.3);
            } else if (nodesFarRightOfWindow.includes(d.source) || nodesFarLeftOfWindow.includes(d.source)) {
                d3.select(this).attr('opacity', 0.15);
            } else {
                d3.select(this).attr('opacity', 0);
            }
        })
        timeline.selectAll('.node-group').filter(n => !nodesInWindow.includes(n)).attr('opacity', 0.2);
    } else {
        links.attr('opacity', 1.0);
    }
    links.filter(l => l.source.id === d.id).each(l => {
        transcript.select('#hovered-text-' + l.target.id).attr('fill', "white");
    })
    timeline.selectAll('.node-text').remove();
    timeline.selectAll('.node-text-box').remove();
    timeline.selectAll('.link-text').remove();
    topicBubbles.selectAll(".bubble").transition().attr("fill", "transparent").attr('r', radius);
}

/**
 * Adds a svg <g> element that contains the text of all nodes that are inside the sliding window or, if the sliding
 * window is empty, all the text. Groups the text by speaker, wraps lines that are too long and fills lines by continuing
 * adding text until a line is full.
 * For this purpose, it is iterated over every text of a node in either all the nodes or the nodes that are inside the
 * sliding window. Whenever the speaker changes between texts, the speaker name is added as svg text element. For every
 * text, a svg text element is added that has the same id as the node the text originates from for fast association.
 * For each text, also a tspan element is generated. The text is broken down into words and the words added to the tspan
 * until the line is full (i.e. the computed text length exceeds the textbox width) and the last word has to be removed.
 * The "full" tspan is added and a new line is started for the remaining words in the text. The next text starts in the
 * same line as the previous ends in.
 * Each spoken part until the speaker changes or the last text has been fit gets a background rectangle that is in the
 * same color, the speaker is assigned in the timeline.
 *
 */
function addTranscriptText() {
    textBox = transcript.append('g').attr('class', ".hover-box").attr('id', "hover-box").on("wheel", scrollText);
    let currentX = 10, currentY = 0.5, prevBoxY = 0, previousSpeaker = null, background = null, defaultX = 15;
    let nodesInTextbox = nodesInWindow && nodesInWindow.length > 0 ? nodesInWindow : nodeData;
    nodesInTextbox.forEach(function (node) {
        let text = node.text, words = text.split(/\s/), line = [], speaker = node.speaker, previousX = 0;
        if (speaker !== previousSpeaker) {
            previousSpeaker !== null ? currentY += 2.4 : currentY += 0; // Add space before writing the next speaker name.
            textBox.append('text').attr("class", "speaker-name").text(speaker).attr('y', currentY + "em").attr('x', 5);
            background?.attr('height', currentY - prevBoxY + "em"); // Finish the previous background after the height is known.
            background = textBox.append('rect').attr("class", "text-background").attr('x', 10).attr('y', (currentY + 0.25) + "em")
                .attr('width', TEXT_BOX_WIDTH).style('fill', colorScale(speaker));
            currentY += 1.2; // Add space below a speaker name.
            currentX = defaultX; // Default value of a new line.
            prevBoxY = currentY + 1.0;
        }
        currentX = currentX === defaultX || text[0] === "," ? currentX : currentX + 5 // Add a little space to the previous text if it isn't the beginning of a new line or starts with a comma.
        let textElement = textBox.append("text").attr('id', `hovered-text-${node.id}`).attr("fill", "white")
            .attr("x", currentX).attr("y", currentY + "em").attr("class", "hover-text")
            .on("mouseover", event => {
                hoverAction(event, node)
            })
            .on('mouseout', (event) => {
                unHoverAction(event, node)
            });
        let tspan = textElement.append("tspan").attr("x", currentX).attr("y", currentY + "em")
        previousSpeaker = speaker;
        previousX = currentX; // previousX is set to the line length the previous text (i.e. iteration) ended with.
        words.forEach(word => {
            line.push(word);
            tspan.text(line.join(" "));
            if (previousX + tspan.node().getComputedTextLength() > TEXT_BOX_WIDTH - 5) {
                // Line is full, remove the word that's "too much", add tspan and start new line.
                line.pop();
                tspan.text(line.join(" "));
                line = [word];
                currentX = defaultX;
                currentY += 1.2;
                previousX = defaultX;
                tspan = textElement.append("tspan").attr("x", currentX).attr("y", currentY + "em").text(word);
            }
            currentX = previousX + tspan.node().getComputedTextLength(); // Track the total line length at that point.
        });
    });
    background?.attr('height', (currentY - prevBoxY + 2.4) + "em"); // Finish the last background.
}

/**
 * Determines the positions of the ticks on the x-axis of the timeline by choosing nodes that are distant enough to
 * prevent the ticks from colliding even if the nodes size is decreased, and they are closer to each other due to using
 * the slider.
 *
 * @returns A boolean array where true determines that a tick should be at that nodes start position.
 */
function findNodesToShowText() {
    const nodesToShowText = [];
    let lastNodeX = 0;

    nodeData.forEach(function (d, i) {
        const barX = xScale(d.start_time);

        if (barX >= lastNodeX + HALF_WINDOW_SIZE * 2.5 || xScale(d.end_time) - barX > HALF_WINDOW_SIZE * 2.5) {
            nodesToShowText[i] = true;
            lastNodeX = barX;
        } else {
            nodesToShowText[i] = false;
        }
    });
    return nodesToShowText;
}

/**
 * Scroll function for the transcript. Scrolling will all the elements in the transcripts textbox move one line in the
 * scroll direction. The elements can only be scrolled up until the last line is reached and only scrolled up until the
 * first line is on top. The upward scroll direction limit is determined by font size and transcript height.
 *
 * @param event The scroll event.
 */
function scrollText(event) {
    event.preventDefault();
    const allTexts = textBox.selectAll('text');
    const allRects = textBox.selectAll('rect');
    const allTSpans = textBox.selectAll('tspan');
    const scroll = event.deltaY > 0 ? -1 : 1;
    const firstTextY = parseFloat(d3.select(allTexts.nodes()[0]).attr("y"));
    const lastTextY = parseFloat(allTexts.filter(':last-child').attr("y"));
    const fontSize = parseInt(window.getComputedStyle(document.querySelector("body")).fontSize)
    const max_y = TRANSCRIPT_HEIGHT / fontSize;
    if ((lastTextY > max_y || scroll === 1) && (firstTextY < 0.5 || scroll === -1)) {
        function updateElementY(selection) {
            selection.each(function () {
                if (d3.select(this).attr('id') !== 'hover-box') {
                    const currentY = parseFloat(d3.select(this).attr("y"));
                    const newY = currentY + scroll;
                    d3.select(this).attr('y', newY + "em");
                }
            });
        }

        updateElementY(allTexts);
        updateElementY(allRects);
        updateElementY(allTSpans);
    }
}

/**
 * Calculates the position and maximum size of the bubbles based on the number of bubbles and the given space. The
 * bubbles are positioned within a grid where every second row is shifted in x-direction by half a bubble.
 *
 * @param numBubbles The number of bubbles.
 * @param rectWidth The width of the rectangle the bubbles must fit in.
 * @param rectHeight The height of the rectangle the bubbles must fit in.
 * @returns An array with the position for each bubble, consisting of the x value, the y value und the radius of the
 * bubble.
 */
const calculateBubblePositions = (numBubbles, rectWidth, rectHeight) => {
    const bubblePositions = [];
    const aspectRatio = rectWidth / rectHeight;
    const cols = Math.ceil(Math.sqrt(numBubbles * aspectRatio));
    const rows = Math.ceil(numBubbles / cols);
    const colWidth = rectWidth / cols;
    const rowHeight = rectHeight / rows;
    const minDimension = Math.min(colWidth, rowHeight);
    const shiftAmount = minDimension / 2;
    radius = minDimension / 2 - 3;

    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols && bubblePositions.length < numBubbles; j++) {
            let x = (j + 0.5) * colWidth;
            const y = (i + 0.5) * rowHeight;
            if (i % 2 === 1) {
                x += shiftAmount;
            }
            bubblePositions.push({x, y, r: radius});
        }
    }

    return bubblePositions;
};

/**
 * Generate a svg <g> elements that represents a topic. Each element consists of a circle and a number of words, where
 * the words are placed in a circular way inside the bubble.
 *
 * @param words An array of words.
 * @param position An object containing an x-value, a y-value and the radius of the bubble.
 */
const generateBubble = (words, position) => {

    const bubble = topicBubbles.append('g')
        .attr('transform', `translate(${position.x},${position.y})`)
        .attr('class', 'topic-bubble');

    bubble.append('circle')
        .attr('class', 'bubble')
        .attr('r', position.r)
        .attr('fill', 'transparent')
        .on('mouseover', function () {
            highlightTopics(words, position.r, d3.select(this));
        })
        .on("mouseout", function () {
            unHighlightTopics(position.r, d3.select(this));
        });

    bubble.selectAll('.word')
        .data(words)
        .enter().append('text')
        .attr('class', 'topic')
        .attr('x', (d, i) => Math.cos(i / words.length * 2 * Math.PI) * (position.r - 10))
        .attr('y', (d, i) => Math.sin(i / words.length * 2 * Math.PI) * (position.r - 10))
        .attr("fill", "white")
        .text(d => d)
        .on('mouseover', function () {
            highlightTopic(d3.select(this));
        })
        .on("mouseout", function () {
            unHighlightTopic(d3.select(this));
        });
};

/**
 * Creates the topic bubble svg. First the positions of the bubbles is calculated, based on the number of bubbles and
 * the given height and width. Then, one bubble (a circle containing words) is generated for each topic and assigned one
 * of the computed positions.
 *
 * @param topicData A list of topics, each represented by a list of words.
 */
function createTopicBubbles(topicData) {
    topicBubbles = createSVG('#topicBubbles', TOPIC_BUBBLE_WIDTH, TOPIC_BUBBLE_HEIGHT, TOPIC_BUBBLE_MARGINS);

    const backgroundWidth = SCREEN_WIDTH / 6;
    const backgroundHeight = 1 / 3 * SCREEN_HEIGHT;
    const numBubbles = topicData.length;
    const bubblePositions = calculateBubblePositions(numBubbles, backgroundWidth, backgroundHeight);

    topicData.forEach((list, i) => {
        generateBubble(list, bubblePositions[i]);
    });
}

/**
 * Highlights the topic bubble by increasing its size and changing its color, marks the nodes in the timeline, that have
 * a text which contains one of the words in the topic bubble, and highlights the respective text elements in the
 * transcript by changing their color.
 *
 * @param topicList A list of words that are inside the topic bubble.
 * @param radius The radius of the topic bubble.
 * @param hoveredElement A selection of the topic bubble svg <g> element that is hovered on.
 */
function highlightTopics(topicList, radius, hoveredElement) {
    const filteredNodes = nodes.filter(node => {
        return topicList.some(topic => node.text.toLowerCase().includes(topic.toLowerCase()));
    });
    filteredNodes.attr("stroke", "#b794f4").attr("stroke-width", "2px");
    let textElements = transcript.selectAll('text').filter(function () {
        return topicList.some(topic => this.textContent.includes(topic));
    });
    textElements.attr("fill", '#b794f4');
    hoveredElement
        .transition()
        .attr('r', radius * 1.2)
        .attr('fill', '#b794f4');
}

/**
 * Removes the highlighting inflicted by hovering on a topic bubble from all nodes and transcript text elements and
 * resets the size and color of the topic bubble to its default state.
 *
 * @param radius The default radius of the topic bubble.
 * @param hoveredElement A selection of the topic bubble svg element.
 */
function unHighlightTopics(radius, hoveredElement) {
    nodes.attr("stroke", "none");
    transcript.selectAll('text').attr("fill", "white");
    hoveredElement
        .transition()
        .attr('r', radius)
        .attr('fill', 'transparent');
}

/**
 * Highlights a word in a topic bubble by changing its color, marks the nodes in the timeline, that have
 * a text which contains the words, and highlights the respective text elements in the
 * transcript by changing their color.
 *
 * @param hoveredElement A selection of the text element that is hovered on.
 */
function highlightTopic(hoveredElement) {
    const filteredNodes = nodes.filter(node => node.text.toLowerCase().includes(hoveredElement.text().toLowerCase()));
    filteredNodes.attr("stroke", "#b794f4").attr("stroke-width", "2px");
    let textElements = transcript.selectAll('text').filter(function () {
        return this.textContent.includes(hoveredElement.text());
    });
    textElements.attr("fill", '#b794f4');
    hoveredElement
        .attr('fill', '#b794f4');
}

/**
 * Removes the highlighting inflicted by hovering on a topic bubble from all nodes and transcript text elements and
 * resets the color of the word to its default.
 *
 * @param hoveredElement A selection of the text element.
 */
function unHighlightTopic(hoveredElement) {
    nodes.attr("stroke", "none");
    transcript.selectAll('text').attr("fill", "white");
    hoveredElement
        .attr('fill', 'white');
}